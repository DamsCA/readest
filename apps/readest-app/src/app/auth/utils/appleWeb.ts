// Web sign-in with Apple through our own domain (owner's ask, 24 Nov 2026), on
// the model of googleWeb.ts.
//
// The browser goes to Apple, which posts its answer (form_post, required when
// the name and e-mail are asked for) to <our domain>/api/auth/apple. That route
// hands the ID token on to /auth/apple in the URL fragment, where Supabase
// checks its signature, audience and nonce with signInWithIdToken. No client
// secret is involved, so nothing expires every six months.
import { APPLE_WEB_CLIENT_ID } from '@/services/features';
import { safeNext } from './googleWeb';

const STORAGE_KEY = 'lel-apple-signin';
// Time allowed between the click and the return from Apple.
const MAX_AGE_MS = 10 * 60 * 1000;

interface PendingSignIn {
  state: string;
  nonce: string;
  next: string;
  at: number;
}

export type AppleReturn =
  | { ok: true; idToken: string; nonce: string; next: string }
  | { ok: false; reason: 'cancelled' | 'invalid' };

const randomString = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const sha256Hex = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export async function startAppleSignIn(next: string | null) {
  const state = randomString();
  const nonce = randomString();
  const pending: PendingSignIn = { state, nonce, next: safeNext(next), at: Date.now() };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  const params = new URLSearchParams({
    client_id: APPLE_WEB_CLIENT_ID,
    redirect_uri: `${window.location.origin}/api/auth/apple`,
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    // Apple writes this hash into the token; Supabase receives the nonce itself,
    // hashes it and compares, so a token can't serve another sign-in.
    nonce: await sha256Hex(nonce),
    state,
  });
  window.location.assign(`https://appleid.apple.com/auth/authorize?${params}`);
}

// Reads Apple's answer, passed on by /api/auth/apple in the fragment. The
// pending sign-in is removed whatever the outcome, so it can't be used twice.
export function readAppleReturn(hash: string): AppleReturn {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const saved = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  let pending: PendingSignIn | null = null;
  try {
    pending = saved ? (JSON.parse(saved) as PendingSignIn) : null;
  } catch {
    pending = null;
  }
  if (params.get('error') === 'user_cancelled_authorize') return { ok: false, reason: 'cancelled' };
  const idToken = params.get('id_token');
  if (
    !pending ||
    !idToken ||
    params.get('state') !== pending.state ||
    Date.now() - pending.at > MAX_AGE_MS
  ) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, idToken, nonce: pending.nonce, next: pending.next };
}
