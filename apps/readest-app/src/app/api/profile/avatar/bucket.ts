import { getCloudflareContext } from '@opennextjs/cloudflare';

// Avatars live in the app's R2 bucket (binding VOICE_CACHE = ouiread-livres),
// under avatars/<user_id>, and are served from the app's own origin: the pages
// are cross-origin isolated (COEP), which would block an image from R2 itself.
export interface AvatarBucket {
  get: (
    key: string,
  ) => Promise<{
    arrayBuffer: () => Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  put: (
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
}

export const getAvatarBucket = (): AvatarBucket | undefined => {
  try {
    return (getCloudflareContext().env as { VOICE_CACHE?: AvatarBucket }).VOICE_CACHE;
  } catch {
    return undefined;
  }
};

export const avatarKey = (userId: string) => `avatars/${userId}`;

export const AVATAR_MAX_BYTES = 300_000;
export const AVATAR_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
