import { NextRequest } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { checkPseudo } from './pseudo';

// The reader's public profile (pseudo + avatar), shown to other readers in
// the coming leaderboard. Table public.profiles (ouiread-profiles.sql).

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('pseudo, avatar_version')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return json({ pseudo: data?.pseudo ?? null, avatarVersion: data?.avatar_version ?? null });
}

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  const body = (await req.json().catch(() => null)) as { pseudo?: unknown } | null;
  const checked = checkPseudo(body?.pseudo);
  if (!checked.ok) return json({ error: checked.error }, 400);

  const supabase = createSupabaseAdminClient();
  const { data: taken } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike(
      'pseudo',
      checked.pseudo.replace(/[\\%_]/g, (c) => `\\${c}`),
    )
    .neq('user_id', user.id)
    .limit(1);
  if (taken?.length) return json({ error: 'PSEUDO_TAKEN' }, 409);

  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: user.id, pseudo: checked.pseudo, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  // The unique index is the last word if two readers pick it at once.
  if (error) return json({ error: error.code === '23505' ? 'PSEUDO_TAKEN' : error.message }, 409);
  return json({ pseudo: checked.pseudo });
}
