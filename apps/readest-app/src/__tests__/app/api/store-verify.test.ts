import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Lis et Lead Plus bought in TestFlight (27 Nov 2026): Apple's sandbox holds the
// purchase, and production answers 401 until the app is live on the App Store.

const moi = '11111111-1111-4111-8111-111111111111';
const parti = '22222222-2222-4222-8222-222222222222';
const encore = '33333333-3333-4333-8333-333333333333';

const enregistre = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
const comptes = new Set([moi, encore]);

vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: moi } }),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({ upsert: enregistre }),
    auth: {
      admin: {
        getUserById: async (id: string) =>
          comptes.has(id)
            ? { data: { user: { id } }, error: null }
            : { data: { user: null }, error: { status: 404, message: 'User not found' } },
      },
    },
  }),
}));

import { POST } from '@/app/api/store/verify/route';

const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const transaction = (owner?: string) =>
  `${b64({ alg: 'ES256' })}.${b64({
    bundleId: 'com.lisetlead.app',
    productId: 'lisetlead.plus.mensuel',
    transactionId: '2000001',
    originalTransactionId: '2000001',
    expiresDate: Date.now() + 86_400_000,
    environment: 'Sandbox',
    ...(owner ? { appAccountToken: owner } : {}),
  })}.sig`;

// What Apple answers: production refuses (401), the sandbox has the purchase.
const apple = (owner?: string, sandbox = 200) =>
  vi.fn(async (url: string) => {
    if (url.includes('storekit-sandbox')) {
      return sandbox === 200
        ? Response.json({ signedTransactionInfo: transaction(owner) })
        : new Response('', { status: sandbox });
    }
    return new Response('', { status: 401 });
  });

const demande = () =>
  POST(
    new Request('https://lisetlead.com/api/store/verify', {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: JSON.stringify({ platform: 'ios', transactionId: '2000001' }),
    }),
  );

beforeAll(async () => {
  const cle = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', cle.privateKey));
  let s = '';
  for (const b of der) s += String.fromCharCode(b);
  process.env['APPLE_IAP_ISSUER_ID'] = 'emetteur';
  process.env['APPLE_IAP_KEY_ID'] = 'CLE';
  process.env['APPLE_IAP_PRIVATE_KEY'] =
    `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----`;
});

beforeEach(() => enregistre.mockClear());

describe('a TestFlight purchase', () => {
  it('is found in the sandbox when production refuses with 401', async () => {
    vi.stubGlobal('fetch', apple(moi));
    const res = await demande();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plan: 'plus' });
    expect(enregistre.mock.calls[0]?.[0]).toMatchObject({ user_id: moi, environment: 'Sandbox' });
  });

  it('is unknown, not refused, when neither server has it', async () => {
    vi.stubGlobal('fetch', apple(moi, 404));
    const res = await demande();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'APPLE_UNKNOWN_TRANSACTION' });
  });

  it('still fails loudly when Apple refuses everywhere', async () => {
    vi.stubGlobal('fetch', apple(moi, 401));
    expect(await (await demande()).json()).toMatchObject({ error: 'APPLE_401' });
  });
});

describe('a purchase tied to another Lis et Lead account', () => {
  it('stays with that account while it exists', async () => {
    vi.stubGlobal('fetch', apple(encore));
    const res = await demande();
    expect(res.status).toBe(409);
    expect(enregistre).not.toHaveBeenCalled();
  });

  it('follows its owner to the new account once the old one is deleted', async () => {
    vi.stubGlobal('fetch', apple(parti));
    const res = await demande();
    expect(res.status).toBe(200);
    expect(enregistre.mock.calls[0]?.[0]).toMatchObject({ user_id: moi });
  });
});
