// Web sign-in with Google through our own domain (see GOOGLE_WEB_CLIENT_ID).
//
// Supabase's usual redirect sends the reader to Google with the return address
// <project>.supabase.co/auth/v1/callback, and Google's screen then reads
// "wwpqbnjktkpdpdaekfdu.supabase.co wants to access your Google account".
// Here the browser goes to Google and comes back to <our domain>/auth/google
// (OpenID Connect, implicit flow): Google hands over an ID token in the URL
// fragment, no client secret is involved, and Supabase checks the token's
// signature, audience and nonce in signInWithIdToken.
import { GOOGLE_WEB_CLIENT_ID } from '@/services/features';

const STORAGE_KEY = 'lel-google-signin';
// Time allowed between the click and the return from Google.
const MAX_AGE_MS = 10 * 60 * 1000;

interface PendingSignIn {
  state: string;
  nonce: string;
  next: string;
  at: number;
}

export type GoogleReturn =
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

// After sign-in, only a path of this site: never another site named in the URL.
export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/library';

export async function startGoogleSignIn(next: string | null) {
  const state = randomString();
  const nonce = randomString();
  const pending: PendingSignIn = { state, nonce, next: safeNext(next), at: Date.now() };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  const params = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID,
    redirect_uri: `${window.location.origin}/auth/google`,
    response_type: 'id_token',
    scope: 'openid email profile',
    // Google writes this hash into the token; Supabase receives the nonce
    // itself, hashes it and compares, so a token can't serve another sign-in.
    nonce: await sha256Hex(nonce),
    state,
    prompt: 'select_account',
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

// Reads Google's answer from the fragment. The pending sign-in is removed
// whatever the outcome, so the same answer can't be used twice.
export function readGoogleReturn(hash: string): GoogleReturn {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const saved = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  let pending: PendingSignIn | null = null;
  try {
    pending = saved ? (JSON.parse(saved) as PendingSignIn) : null;
  } catch {
    pending = null;
  }
  if (params.get('error') === 'access_denied') return { ok: false, reason: 'cancelled' };
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
