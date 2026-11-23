import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Premium voices run on Fish Audio's free model. Plus readers are capped at
// about two books a month; a few accounts (public.plans.voice_unlimited, the
// owner's own) listen without the cap. Free readers get a short monthly taste
// that counts every sentence, even one already in the shared memory, except
// for the welcome book, which every reader hears in the premium voice.

const WELCOME = 'Note de l’éditeur. L’ami le lui a rendu avec ces seuls mots : « Ça marche. »';

const hooks = vi.hoisted(() => ({
  plan: 'plus' as string,
  used: 0,
  tracked: [] as Array<{ chars: number; source: unknown }>,
  flag: { data: null as unknown, error: null as unknown },
  fishBodies: [] as Array<Record<string, unknown>>,
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
    getCurrentUsage: async () => hooks.used,
    trackUsage: async (_u: string, _t: string, chars: number, meta: { source?: unknown }) => {
      hooks.tracked.push({ chars, source: meta?.source });
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

const ask = (text = 'Bonjour à vous.') =>
  POST(
    new NextRequest('https://lisetlead.com/api/fishaudio/tts', {
      method: 'POST',
      body: JSON.stringify({ text, reference_id: 'claire' }),
    }),
  );

describe('premium voice allowance', () => {
  beforeEach(() => {
    process.env['FISHAUDIO_API_KEY'] = 'test-key';
    hooks.plan = 'plus';
    hooks.used = 0;
    hooks.tracked = [];
    hooks.flag = { data: null, error: null };
    hooks.fishBodies = [];
    hooks.cached = false;
    hooks.withBucket = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        hooks.fishBodies.push({ model: (init.headers as Record<string, string>)['model'] });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks Fish Audio for the free model', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(hooks.fishBodies).toEqual([{ model: 's2.1-pro-free' }]);
  });

  it('lets a Plus reader listen up to about two books a month', async () => {
    hooks.used = 990_000;
    expect((await ask()).status).toBe(200);
    hooks.used = 999_999;
    expect((await ask()).status).toBe(429);
  });

  it('serves a subscriber from the shared memory without counting it', async () => {
    hooks.used = 999_999;
    hooks.cached = true;
    expect((await ask()).status).toBe(200);
    expect(hooks.tracked).toEqual([]);
  });

  it('lets an unlimited account listen past the cap', async () => {
    hooks.used = 50_000_000;
    hooks.flag = { data: { voice_unlimited: true }, error: null };
    expect((await ask()).status).toBe(200);
  });

  it('keeps the cap when the flag cannot be read', async () => {
    hooks.used = 50_000_000;
    hooks.flag = { data: null, error: { message: 'column does not exist' } };
    expect((await ask()).status).toBe(429);
  });

  it('keeps the free taste short', async () => {
    hooks.plan = 'free';
    hooks.used = 2_400;
    expect((await ask('x'.repeat(200))).status).toBe(402);
  });

  it('counts a free reader’s sentence even when the memory has it', async () => {
    hooks.plan = 'free';
    hooks.cached = true;
    expect((await ask()).status).toBe(200);
    expect(hooks.tracked).toEqual([{ chars: 'Bonjour à vous.'.length, source: 'voice_cache' }]);
    hooks.used = 2_499;
    expect((await ask()).status).toBe(402);
  });

  it('gives every reader the welcome book in the premium voice, uncounted', async () => {
    hooks.plan = 'free';
    hooks.used = 50_000;
    // Spacing and quotes may differ from the book's file: letters decide.
    expect((await ask('L’ami le lui a rendu avec ces seuls mots : "Ça marche."')).status).toBe(200);
    hooks.cached = true;
    expect((await ask('Note de l’éditeur.')).status).toBe(200);
    expect(hooks.tracked).toEqual([]);
  });

  it('does not take another book for the welcome book', async () => {
    hooks.plan = 'free';
    hooks.used = 2_499;
    expect((await ask('Ça marche, dit-il, et il partit.')).status).toBe(402);
  });
});
