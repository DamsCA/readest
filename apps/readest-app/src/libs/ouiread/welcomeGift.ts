import { createSupabaseAdminClient } from '@/utils/supabase';
import { r2Storage } from '@/utils/r2';

/**
 * The book offered to every new Ouiread account: « Ça marche », the French
 * translation of R. H. Jarrett's « It Works » (1926, public domain).
 *
 * Its files sit in the private bucket under `cadeaux/`, next to a small JSON
 * that describes them (written by ouiread-ca-marche/publier-cadeau.mjs):
 *   cadeaux/ca-marche.epub, cadeaux/ca-marche-cover.png, cadeaux/ca-marche.json
 *
 * On a reader's first pull of an empty library, the server copies both files
 * into the reader's own folder, adds the `files` and `books` rows the client
 * expects, and marks the gift as given (`plans.welcome_gift_at`), so it comes
 * once per account, whatever the number of devices.
 */
const GIFT_PREFIX = 'cadeaux/ca-marche';

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

/** Gives the welcome book to this account if it never had it. Returns true when given now. */
export const giveWelcomeGift = async (userId: string): Promise<boolean> => {
  const bucket = process.env['R2_BUCKET_NAME'];
  if (!bucket || process.env['OUIREAD_WELCOME_GIFT'] === 'off') return false;
  if (!(await claimGift(userId))) return false;

  try {
    const manifestResponse = await r2Storage
      .getR2Client()
      .fetch(`${r2Storage.getR2Url()}/${bucket}/${GIFT_PREFIX}.json`);
    if (!manifestResponse.ok) throw new Error(`manifest: HTTP ${manifestResponse.status}`);
    const gift = (await manifestResponse.json()) as GiftManifest;

    const folder = `${userId}/Readest/Books/${gift.hash}`;
    const bookKey = `${folder}/${gift.fileName}`;
    const coverKey = `${folder}/cover.png`;
    const copies: Array<[string, string]> = [
      [`${GIFT_PREFIX}.epub`, bookKey],
      [`${GIFT_PREFIX}-cover.png`, coverKey],
    ];
    for (const [source, destination] of copies) {
      const response = await r2Storage.copyObject(bucket, source, destination);
      if (!response.ok) throw new Error(`copy ${source}: HTTP ${response.status}`);
    }

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { error: filesError } = await admin.from('files').insert([
      { user_id: userId, book_hash: gift.hash, file_key: bookKey, file_size: gift.fileSize },
      { user_id: userId, book_hash: gift.hash, file_key: coverKey, file_size: gift.coverSize },
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
    return true;
  } catch (error) {
    console.error('Welcome gift failed', error);
    await releaseGift(userId);
    return false;
  }
};
