// Sign in with Apple, server side (25 Nov 2026). Apple asks apps that offer
// Sign in with Apple to revoke the user's tokens when the account is deleted
// (App Store Review Guideline 5.1.1(v)). To be able to, we keep the refresh
// token Apple gives for the authorization code the iPhone app sends after a
// sign-in, and revoke it at deletion.
//
// Secrets (Cloudflare Worker): APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID,
// APPLE_SIGNIN_PRIVATE_KEY (the .p8 text of a key with "Sign in with Apple").

export const APPLE_CLIENT_ID = 'com.lisetlead.app';

const b64url = (data: ArrayBuffer | string) => {
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

export const appleSignInConfigured = () =>
  Boolean(
    process.env['APPLE_TEAM_ID'] &&
      process.env['APPLE_SIGNIN_KEY_ID'] &&
      process.env['APPLE_SIGNIN_PRIVATE_KEY'],
  );

/** The short-lived client secret Apple's token endpoints ask for (ES256 JWT). */
export const appleClientSecret = async () => {
  const team = process.env['APPLE_TEAM_ID']!;
  const keyId = process.env['APPLE_SIGNIN_KEY_ID']!;
  const pem = process.env['APPLE_SIGNIN_PRIVATE_KEY']!;
  const now = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const input = `${b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))}.${b64url(
    JSON.stringify({
      iss: team,
      iat: now,
      exp: now + 300,
      aud: 'https://appleid.apple.com',
      sub: APPLE_CLIENT_ID,
    }),
  )}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(signature)}`;
};

/** Exchanges the authorization code from the app for Apple's refresh token. */
export const appleRefreshTokenFromCode = async (code: string) => {
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: await appleClientSecret(),
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`APPLE_TOKEN_${res.status}`);
  const body = (await res.json()) as { refresh_token?: string };
  if (!body.refresh_token) throw new Error('APPLE_NO_REFRESH_TOKEN');
  return body.refresh_token;
};

/** Revokes the reader's Sign in with Apple authorization. */
export const appleRevoke = async (refreshToken: string) => {
  const res = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: await appleClientSecret(),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`APPLE_REVOKE_${res.status}`);
};
