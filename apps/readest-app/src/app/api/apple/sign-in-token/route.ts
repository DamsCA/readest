// The iPhone app sends the authorization code of a Sign in with Apple; we keep
// Apple's refresh token so the authorization can be revoked when the reader
// deletes the account (see utils/appleSignIn.ts, ouiread-apple-tokens.sql).
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { appleRefreshTokenFromCode, appleSignInConfigured } from '@/utils/appleSignIn';

export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(req: Request): Promise<Response> {
  const { user } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user) return json(401, { error: 'NOT_AUTHENTICATED' });
  if (!appleSignInConfigured()) return json(503, { error: 'APPLE_NOT_CONFIGURED' });

  let code = '';
  try {
    code = String(((await req.json()) as { code?: string })?.code ?? '');
  } catch {
    return json(400, { error: 'invalid json' });
  }
  if (!code || code.length > 2000) return json(400, { error: 'code required' });

  let refreshToken: string;
  try {
    refreshToken = await appleRefreshTokenFromCode(code);
  } catch (e) {
    console.error('apple sign-in token', String((e as Error)?.message || e));
    return json(502, { error: 'APPLE_REFUSED' });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('apple_tokens')
    .upsert(
      { user_id: user.id, refresh_token: refreshToken, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) {
    console.error('apple_tokens upsert', error);
    return json(500, { error: 'save failed' });
  }
  return json(200, { ok: true });
}
