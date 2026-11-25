import { createSupabaseAdminClient } from '@/utils/supabase';
import { r2Storage } from '@/utils/r2';

/**
 * The books offered to every new Ouiread account:
 * - « Ça marche », the French translation of R. H. Jarrett's « It Works »
 *   (1926, public domain), written by ouiread-ca-marche/publier-cadeau.mjs;
 * - « La formule de Kevin Trudeau », our French guide (6 ingredients out of 45),
 *   written by ktaffilliate/guide_fr/fabriquer_guide_epub.py (owner's decision,
 *   25 Nov 2026: « C'est avec la liseuse qu'il y a Ça marche et notre guide »).
 *
 * Their files sit in the private bucket under `cadeaux/`, each next to a small
 * JSON that describes them: cadeaux/<name>.epub, cadeaux/<name>-cover.png,
 * cadeaux/<name>.json.
 *
 * On a reader's first pull of an empty library, the server copies the files
 * into the reader's own folder, adds the `files` and `books` rows the client
 * expects, and marks the gift as given (`plans.welcome_gift_at`), so it comes
 * once per account, whatever the number of devices. The first book is the one
 * the library unwraps; if an extra book fails, the first one is still given.
 */
const GIFT_PREFIXES = ['cadeaux/ca-marche', 'cadeaux/guide-formule'];

interface GiftManifest {
  hash: string;
  title: string;
  sourceTitle: string;
  author: string;
  format: string;
  fileName: string;
  fileSize: number;
  coverHash: string;
  coverSize: number;
}

const claimGift = async (userId: string): Promise<boolean> => {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  // Only one request per account gets past this update.
  const { data, error } = await admin
    .from('plans')
    .update({ welcome_gift_at: now })
    .eq('id', userId)
    .is('welcome_gift_at', null)
    .select('id');
  if (error) {
    console.error('Welcome gift: claim failed', error);
    return false;
  }
  if (data && data.length > 0) return true;

  // No row was updated: either the gift was already given, or the account
  // predates the trigger that creates its plans row.
  const { data: row } = await admin.from('plans').select('id').eq('id', userId).maybeSingle();
  if (row) return false;
  const { error: insertError } = await admin
    .from('plans')
    .insert({ id: userId, welcome_gift_at: now });
  return !insertError;
};

const releaseGift = async (userId: string) => {
  const admin = createSupabaseAdminClient();
  await admin.from('plans').update({ welcome_gift_at: null }).eq('id', userId);
};

const copyGift = async (
  userId: string,
  bucket: string,
  prefix: string,
  now: string,
): Promise<string> => {
  const manifestResponse = await r2Storage
    .getR2Client()
    .fetch(`${r2Storage.getR2Url()}/${bucket}/${prefix}.json`);
  if (!manifestResponse.ok) throw new Error(`${prefix} manifest: HTTP ${manifestResponse.status}`);
  const gift = (await manifestResponse.json()) as GiftManifest;

  const folder = `${userId}/Readest/Books/${gift.hash}`;
  const bookKey = `${folder}/${gift.fileName}`;
  const coverKey = `${folder}/cover.png`;
  const copies: Array<[string, string]> = [
    [`${prefix}.epub`, bookKey],
    [`${prefix}-cover.png`, coverKey],
  ];
  for (const [source, destination] of copies) {
    const response = await r2Storage.copyObject(bucket, source, destination);
    if (!response.ok) throw new Error(`copy ${source}: HTTP ${response.status}`);
  }

  const admin = createSupabaseAdminClient();
  const { error: filesError } = await admin.from('files').insert([
    {
      user_id: userId,
      book_hash: gift.hash,
      file_key: bookKey,
      file_size: gift.fileSize,
    },
    {
      user_id: userId,
      book_hash: gift.hash,
      file_key: coverKey,
      file_size: gift.coverSize,
    },
  ]);
  if (filesError) throw filesError;

  const { error: bookError } = await admin.from('books').upsert(
    {
      user_id: userId,
      book_hash: gift.hash,
      format: gift.format,
      title: gift.title,
      source_title: gift.sourceTitle,
      author: gift.author,
      cover_hash: gift.coverHash,
      created_at: now,
      updated_at: now,
      uploaded_at: now,
    },
    { onConflict: 'user_id,book_hash' },
  );
  if (bookError) throw bookError;
  return gift.hash;
};

/**
 * Gives the welcome books to this account if it never had them. Returns the
 * first book's hash when given now (the library then plays the gift's
 * unwrapping, app/library/components/WelcomeGift.tsx), null otherwise.
 */
export const giveWelcomeGift = async (userId: string): Promise<string | null> => {
  const bucket = process.env['R2_BUCKET_NAME'];
  if (!bucket || process.env['OUIREAD_WELCOME_GIFT'] === 'off') return null;
  if (!(await claimGift(userId))) return null;

  const [first, ...extras] = GIFT_PREFIXES;
  const now = new Date().toISOString();
  let firstHash: string;
  try {
    firstHash = await copyGift(userId, bucket, first!, now);
  } catch (error) {
    console.error('Welcome gift failed', error);
    await releaseGift(userId);
    return null;
  }
  for (const prefix of extras) {
    try {
      await copyGift(userId, bucket, prefix, now);
    } catch (error) {
      console.error(`Welcome gift: extra book ${prefix} failed`, error);
    }
  }
  return firstHash;
};
