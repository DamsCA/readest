import { NextRequest } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

// The audience figures shown on /stats, for the accounts listed in
// public.admins_stats only (docker/volumes/db/ouiread/ouiread-visites.sql).

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest) {
  const { user } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  const admin = createSupabaseAdminClient();
  const { data: autorise } = await admin
    .from('admins_stats')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!autorise) return json({ error: 'FORBIDDEN' }, 403);

  const demande = Number(new URL(req.url).searchParams.get('jours')) || 7;
  const jours = Math.min(90, Math.max(1, Math.round(demande)));
  const { data, error } = await admin.rpc('stats_visites', { jours });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}
