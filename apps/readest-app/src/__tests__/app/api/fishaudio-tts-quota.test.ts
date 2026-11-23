import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Premium voices run on Fish Audio's free model. Plus readers are capped at
// about two books a month; a few accounts (public.plans.voice_unlimited, the
// owner's own) listen without the cap. Free readers get a short monthly taste
// that counts every sentence, even one already in the shared memory, except
// for the welcome book, which every reader hears in the premium voice (itself
// bounded per reader). Every allowance is reserved before Fish is called, and
// only our voices and format are ever forwarded.

const WELCOME = 'Note de l’éditeur. L’ami le lui a rendu avec ces seuls mots : « Ça marche. »';
const CLAIRE = 'da05ae30d8c0428eb47498df524e448c';

const hooks = vi.hoisted(() => ({
  plan: 'plus' as string,
  used: {} as Record<string, number>,
  reserved: [] as Array<{ type: string; amount: number }>,
  released: [] as Array<{ type: string; amount: number }>,
  tracked: [] as Array<{ type: string; chars: number }>,
  usageDown: false,
  flag: { data: null as unknown, error: null as unknown },
  fishCalls: [] as Array<{ model: string; body: Record<string, unknown> }>,
  fishStatus: 200,
  cached: false,
  withBucket: true,
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (!hooks.withBucket) throw new Error('no cloudflare context in tests');
    return {
      env: {
        VOICE_CACHE: {
          get: async (key: string) => {
            if (key === 'cadeaux/ca-marche.txt') {
              return { arrayBuffer: async () => new TextEncoder().encode(WELCOME).buffer };
            }
            return hooks.cached ? { arrayBuffer: async () => new Uint8Array([9]).buffer } : null;
          },
          put: async () => undefined,
        },
      },
    };
  },
}));

vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'reader-1' }, token: 'token' }),
  getSubscriptionPlan: () => hooks.plan,
}));

vi.mock('@/utils/usage', () => ({
  UsageStatsManager: {
    reserve: async (_u: string, type: string, amount: number, _p: string, cap: number) => {
      if (hooks.usageDown) return { status: 'error', total: 0 };
      const used = hooks.used[type] ?? 0;
      if (used + amount > cap) return { status: 'over', total: used };
      hooks.used[type] = used + amount;
      hooks.reserved.push({ type, amount });
      return { status: 'ok', total: used + amount };
    },
    release: async (_u: string, type: string, amount: number) => {
      hooks.used[type] = (hooks.used[type] ?? 0) - amount;
      hooks.released.push({ type, amount });
    },
    trackUsage: async (_u: string, type: string, chars: number) => {
      hooks.tracked.push({ type, chars });
    },
  },
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'plans') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => hooks.flag }) }),
      };
    },
  }),
}));

const { POST } = await import('@/app/api/fishaudio/tts/route');

const ask = (text = 'Bonjour à vous.', extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('https://lisetlead.com/api/fishaudio/tts', {
      method: 'POST',
      body: JSON.stringify({
        text,
        reference_id: CLAIRE,
        format: 'mp3',
        mp3_bitrate: 128,
        ...extra,
      }),
    }),
  );

describe('premium voice allowance', () => {
  beforeEach(() => {
    process.env['FISHAUDIO_API_KEY'] = 'test-key';
    hooks.plan = 'plus';
    hooks.used = {};
    hooks.reserved = [];
    hooks.released = [];
    hooks.tracked = [];
    hooks.usageDown = false;
    hooks.flag = { data: null, error: null };
    hooks.fishCalls = [];
    hooks.fishStatus = 200;
    hooks.cached = false;
    hooks.withBucket = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        hooks.fishCalls.push({
          model: (init.headers as Record<string, string>)['model']!,
          body: JSON.parse(String(init.body)),
        });
        return hooks.fishStatus === 200
          ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
          : new Response('busy', { status: hooks.fishStatus });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks Fish Audio for the free model', async () => {
    expect((await ask()).status).toBe(200);
    expect(hooks.fishCalls.map((c) => c.model)).toEqual(['s2.1-pro-free']);
  });

  it('forwards only our voice and format, never what the reader adds', async () => {
    const res = await ask('Bonjour à vous.', {
      references: [{ audio: 'AAAA', text: 'cloned' }],
      format: 'wav',
      latency: 'balanced',
    });
    expect(res.status).toBe(200);
    expect(hooks.fishCalls[0]!.body).toEqual({
      text: 'Bonjour à vous.',
      reference_id: CLAIRE,
      format: 'mp3',
      mp3_bitrate: 128,
    });
  });

  it('refuses a voice that is not one of ours', async () => {
    expect((await ask('Bonjour.', { reference_id: 'someone-elses-voice' })).status).toBe(400);
    expect(hooks.fishCalls).toEqual([]);
  });

  it('lets a Plus reader listen up to about two books a month', async () => {
    hooks.used['premium_voice_chars'] = 990_000;
    expect((await ask()).status).toBe(200);
    hooks.used['premium_voice_chars'] = 999_999;
    expect((await ask()).status).toBe(429);
  });

  it('reserves before calling Fish and hands it back when Fish fails', async () => {
    hooks.fishStatus = 429;
    expect((await ask()).status).toBe(503);
    expect(hooks.reserved).toEqual([{ type: 'premium_voice_chars', amount: 15 }]);
    expect(hooks.released).toEqual([{ type: 'premium_voice_chars', amount: 15 }]);
  });

  it('refuses when the usage cannot be read (never lifts a cap)', async () => {
    hooks.usageDown = true;
    expect((await ask()).status).toBe(503);
    expect(hooks.fishCalls).toEqual([]);
  });

  it('serves a subscriber from the shared memory without counting it', async () => {
    hooks.used['premium_voice_chars'] = 999_999;
    hooks.cached = true;
    expect((await ask()).status).toBe(200);
    expect(hooks.reserved).toEqual([]);
  });

  it('lets an unlimited account listen past the cap', async () => {
    hooks.used['premium_voice_chars'] = 50_000_000;
    hooks.flag = { data: { voice_unlimited: true }, error: null };
    expect((await ask()).status).toBe(200);
    expect(hooks.tracked).toEqual([{ type: 'premium_voice_chars', chars: 15 }]);
  });

  it('keeps the cap when the flag cannot be read', async () => {
    hooks.used['premium_voice_chars'] = 50_000_000;
    hooks.flag = { data: null, error: { message: 'column does not exist' } };
    expect((await ask()).status).toBe(429);
  });

  it('keeps the free taste short', async () => {
    hooks.plan = 'free';
    hooks.used['premium_voice_chars'] = 2_400;
    expect((await ask('x'.repeat(200))).status).toBe(402);
  });

  it('counts a free reader’s sentence even when the memory has it', async () => {
    hooks.plan = 'free';
    hooks.cached = true;
    expect((await ask()).status).toBe(200);
    expect(hooks.reserved).toEqual([{ type: 'premium_voice_chars', amount: 15 }]);
    hooks.used['premium_voice_chars'] = 2_499;
    expect((await ask()).status).toBe(402);
  });

  it('gives every reader the welcome book in the premium voice, outside the taste', async () => {
    hooks.plan = 'free';
    hooks.used['premium_voice_chars'] = 50_000;
    // Spacing and quotes may differ from the book's file: letters decide.
    expect((await ask('L’ami le lui a rendu avec ces seuls mots : "Ça marche."')).status).toBe(200);
    hooks.cached = true;
    expect((await ask('Note de l’éditeur.')).status).toBe(200);
    expect(hooks.reserved.map((r) => r.type)).toEqual(['welcome_voice_chars']);
  });

  it('bounds the welcome book per reader too', async () => {
    hooks.plan = 'free';
    hooks.used['welcome_voice_chars'] = 150_000;
    expect((await ask('Note de l’éditeur.')).status).toBe(429);
    expect(hooks.fishCalls).toEqual([]);
  });

  it('does not take another book for the welcome book', async () => {
    hooks.plan = 'free';
    hooks.used['premium_voice_chars'] = 2_499;
    expect((await ask('Ça marche, dit-il, et il partit.')).status).toBe(402);
  });

  it('refuses an oversized request body', async () => {
    expect((await ask('Bonjour.', { padding: 'x'.repeat(20_000) })).status).toBe(413);
  });
});
