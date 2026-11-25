// Lis et Lead Plus bought in the phone apps (25 Nov 2026). The app sends the
// purchase it just received; we ask Apple or Google whether it is real and
// still valid, then record it in public.store_subscriptions. The token hook
// turns a valid one into the « plus » plan (ouiread-boutiques.sql).
//
// Secrets (Cloudflare Worker): APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID,
// APPLE_IAP_PRIVATE_KEY (the .p8 text), GOOGLE_PLAY_SERVICE_ACCOUNT (JSON).
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';

export const dynamic = 'force-dynamic';

const BUNDLE_ID = 'com.lisetlead.app';
const APPLE_PRODUCTS = new Set(['lisetlead.plus.mensuel', 'lisetlead.plus.annuel']);
const GOOGLE_SUBSCRIPTION = 'lisetlead_plus';

const json = (status: number, body: unknown) => Response.json(body, { status });

// ---------- Small JWT helpers (Web Crypto) ----------

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const pemToDer = (pem: string) => {
  const body = pem
    .replace(/-----[^-]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

const signJwt = async (
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  pem: string,
  alg: 'ES256' | 'RS256',
) => {
  const algo =
    alg === 'ES256'
      ? { import: { name: 'ECDSA', namedCurve: 'P-256' }, sign: { name: 'ECDSA', hash: 'SHA-256' } }
      : {
          import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          sign: { name: 'RSASSA-PKCS1-v1_5' },
        };
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), algo.import, false, ['sign']);
  const input = `${b64url(JSON.stringify({ ...header, alg, typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(algo.sign, key, new TextEncoder().encode(input));
  return `${input}.${b64url(signature)}`;
};

const decodeJwsPayload = (jws: string) => {
  const part = jws.split('.')[1] ?? '';
  return JSON.parse(
    atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)),
  );
};

// ---------- Apple: App Store Server API ----------

type Verified = {
  originalId: string;
  productId: string;
  expiresAt: Date;
  active: boolean;
  environment?: string;
};

const verifyApple = async (transactionId: string, userId: string): Promise<Verified> => {
  const issuer = process.env['APPLE_IAP_ISSUER_ID'];
  const keyId = process.env['APPLE_IAP_KEY_ID'];
  const pem = process.env['APPLE_IAP_PRIVATE_KEY'];
  if (!issuer || !keyId || !pem) throw new Error('APPLE_NOT_CONFIGURED');
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { kid: keyId },
    { iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1', bid: BUNDLE_ID },
    pem,
    'ES256',
  );
  let body: { signedTransactionInfo?: string } | null = null;
  for (const host of ['api.storekit.itunes.apple.com', 'api.storekit-sandbox.itunes.apple.com']) {
    const res = await fetch(
      `https://${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (res.ok) {
      body = await res.json();
      break;
    }
    if (res.status !== 404) throw new Error(`APPLE_${res.status}`);
  }
  if (!body?.signedTransactionInfo) throw new Error('APPLE_UNKNOWN_TRANSACTION');
  const t = decodeJwsPayload(body.signedTransactionInfo);
  if (t.bundleId !== BUNDLE_ID || !APPLE_PRODUCTS.has(t.productId))
    throw new Error('APPLE_WRONG_PRODUCT');
  if (t.appAccountToken && String(t.appAccountToken).toLowerCase() !== userId.toLowerCase()) {
    throw new Error('APPLE_OTHER_ACCOUNT');
  }
  const expiresAt = new Date(Number(t.expiresDate || 0));
  return {
    originalId: String(t.originalTransactionId || t.transactionId),
    productId: t.productId,
    expiresAt,
    active: !t.revocationDate && expiresAt.getTime() > Date.now(),
    environment: t.environment,
  };
};

// ---------- Google: Play Developer API ----------

const googleAccessToken = async () => {
  const raw = process.env['GOOGLE_PLAY_SERVICE_ACCOUNT'];
  if (!raw) throw new Error('GOOGLE_NOT_CONFIGURED');
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    {},
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 600,
    },
    sa.private_key,
    'RS256',
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`GOOGLE_TOKEN_${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
};

const verifyGoogle = async (purchaseToken: string, userId: string): Promise<Verified> => {
  const access = await googleAccessToken();
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${BUNDLE_ID}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${access}` } },
  );
  if (!res.ok) throw new Error(`GOOGLE_${res.status}`);
  const s = (await res.json()) as {
    subscriptionState?: string;
    lineItems?: { productId: string; expiryTime: string }[];
    externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
    testPurchase?: unknown;
  };
  const item = s.lineItems?.find((l) => l.productId === GOOGLE_SUBSCRIPTION);
  if (!item) throw new Error('GOOGLE_WRONG_PRODUCT');
  const owner = s.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (owner && owner !== userId) throw new Error('GOOGLE_OTHER_ACCOUNT');
  const expiresAt = new Date(item.expiryTime);
  const valid = [
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_CANCELED',
  ];
  return {
    originalId: purchaseToken,
    productId: item.productId,
    expiresAt,
    active: valid.includes(s.subscriptionState ?? '') && expiresAt.getTime() > Date.now(),
    environment: s.testPurchase ? 'test' : 'production',
  };
};

// ---------- Route ----------

export async function POST(req: Request): Promise<Response> {
  const { user } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user) return json(401, { error: 'NOT_AUTHENTICATED' });

  let body: {
    platform?: string;
    productId?: string;
    purchaseToken?: string;
    transactionId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid json' });
  }
  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : null;
  if (!platform) return json(400, { error: 'platform required' });

  let v: Verified;
  try {
    if (platform === 'ios') {
      if (!body.transactionId) return json(400, { error: 'transactionId required' });
      v = await verifyApple(body.transactionId, user.id);
    } else {
      if (!body.purchaseToken) return json(400, { error: 'purchaseToken required' });
      v = await verifyGoogle(body.purchaseToken, user.id);
    }
  } catch (e) {
    const code = String((e as Error)?.message || e);
    console.error('store verify failed', platform, code);
    if (/NOT_CONFIGURED/.test(code)) return json(503, { error: code });
    if (/OTHER_ACCOUNT/.test(code)) return json(409, { error: code });
    return json(402, { error: code });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('store_subscriptions').upsert(
    {
      user_id: user.id,
      platform,
      original_id: v.originalId,
      product_id: v.productId,
      status: v.active ? 'active' : 'expired',
      expires_at: v.expiresAt.toISOString(),
      environment: v.environment ?? null,
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'platform,original_id' },
  );
  if (error) {
    console.error('store_subscriptions upsert', error);
    return json(500, { error: 'save failed' });
  }
  return json(200, { plan: v.active ? 'plus' : 'free', expiresAt: v.expiresAt.toISOString() });
}
