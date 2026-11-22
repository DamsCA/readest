import { NextRequest } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { AVATAR_MAX_BYTES, AVATAR_TYPES, avatarKey, getAvatarBucket } from './bucket';

// The reader's avatar: the app resizes the picture to 256 x 256 before
// sending it (PublicProfile), so a few tens of kilobytes arrive here.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  const bucket = getAvatarBucket();
  if (!bucket) return json({ error: 'Storage not configured' }, 503);

  const contentType = (req.headers.get('content-type') || '').split(';')[0]!.trim();
  if (!AVATAR_TYPES.includes(contentType)) return json({ error: 'AVATAR_TYPE' }, 415);
  const image = await req.arrayBuffer();
  if (!image.byteLength) return json({ error: 'AVATAR_EMPTY' }, 400);
  if (image.byteLength > AVATAR_MAX_BYTES) return json({ error: 'AVATAR_TOO_LARGE' }, 413);

  await bucket.put(avatarKey(user.id), image, { httpMetadata: { contentType } });
  const avatarVersion = Date.now();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: user.id, avatar_version: avatarVersion, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) return json({ error: error.message }, 500);
  return json({ avatarVersion });
}

export async function DELETE(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  const bucket = getAvatarBucket();
  if (bucket) await bucket.delete(avatarKey(user.id)).catch(() => undefined);
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_version: null, updated_at: new Date().toISOString() })
    .eq('user_id', user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ avatarVersion: null });
}
