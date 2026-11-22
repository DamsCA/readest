import { NextRequest } from 'next/server';
import { avatarKey, getAvatarBucket } from '../bucket';

// A reader's avatar, public like the pseudo (leaderboard). The address carries
// ?v=<avatar_version>, so it can be cached for a long time: a new picture gets
// a new address.

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!UUID.test(userId)) return new Response('Not found', { status: 404 });
  const bucket = getAvatarBucket();
  const object = bucket ? await bucket.get(avatarKey(userId)).catch(() => null) : null;
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(await object.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
