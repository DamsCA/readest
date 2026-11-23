import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import {
  getStoragePlanData,
  validateUserAndToken,
  STORAGE_QUOTA_GRACE_BYTES,
} from '@/utils/access';
import { getDownloadSignedUrl, getUploadSignedUrl, isSafeObjectKeyName } from '@/utils/object';
import { READEST_PUBLIC_STORAGE_BASE_URL } from '@/services/constants';

// One book file at most (the presigned URL signs the exact size, so the
// declared size is the real one).
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
// Temporary files are small images (the desktop app's cover for Discord):
// they skip the storage quota, so they stay tiny.
const MAX_TEMP_UPLOAD_BYTES = 2 * 1024 * 1024;

// The reader's live storage, from the database. The SQL function
// (ouiread-extras.sql) sums it in one query; until it exists, the rows are
// added up page by page (the API returns at most 1,000 rows at a time).
// NaN on any error: the caller refuses.
const readStorageUsage = async (
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
): Promise<number> => {
  const { data, error } = await supabase.rpc('ouiread_storage_usage', { p_user_id: userId });
  if (!error) return Number(data);
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data: rows, error: rowsError } = await supabase
      .from('files')
      .select('file_size')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + 999);
    if (rowsError || !rows) return NaN;
    for (const row of rows) total += Number(row.file_size) || 0;
    if (rows.length < 1000) return total;
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  if (!user || !token) {
    return res.status(403).json({ error: 'Not authenticated' });
  }

  const { fileName, fileSize, bookHash, replicaKind, replicaId, temp = false } = req.body;

  // Reject object-key path traversal before building any key. `fileName` is
  // fully client-controlled and is interpolated into `${user.id}/${fileName}`;
  // without this an attacker escapes their own prefix into another user's
  // namespace (GHSA-mfmj-2frf-vhgw).
  if (!isSafeObjectKeyName(fileName)) {
    return res.status(400).json({ error: 'Invalid fileName' });
  }
  const size = Number(fileSize);
  if (!Number.isSafeInteger(size) || size <= 0) {
    return res.status(400).json({ error: 'Invalid fileSize' });
  }
  if (size > (temp ? MAX_TEMP_UPLOAD_BYTES : MAX_UPLOAD_BYTES)) {
    return res.status(413).json({ error: 'File too large' });
  }

  if (temp) {
    try {
      const datetime = new Date();
      const timeStr = datetime.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 10);
      const userStr = user.id.slice(0, 8);
      const fileKey = `temp/img/${timeStr}/${userStr}/${fileName}`;
      const bucketName = process.env['TEMP_STORAGE_PUBLIC_BUCKET_NAME'] || '';
      const uploadUrl = await getUploadSignedUrl(fileKey, size, 1800, bucketName);
      const downloadUrl = await getDownloadSignedUrl(fileKey, 3 * 86400, bucketName);
      const pathname = new URL(downloadUrl).pathname;
      const publicBaseUrl = READEST_PUBLIC_STORAGE_BASE_URL;
      const publicDownloadUrl = `${publicBaseUrl}${pathname.replace(`/${bucketName}`, '')}`;
      return res.status(200).json({
        uploadUrl,
        downloadUrl: publicDownloadUrl,
      });
    } catch (error) {
      console.error('Error creating presigned post for temp file:', error);
      return res.status(500).json({ error: 'Could not create presigned post' });
    }
  }

  try {
    if (!fileName) {
      return res.status(400).json({ error: 'Missing file info' });
    }

    // The plan's quota comes from the token; the usage does NOT: the token can
    // be an hour old, so every upload of that hour would be measured against
    // the same old figure. The real total is read from the database below,
    // after this file is recorded, so parallel uploads cannot all pass.
    const { quota } = getStoragePlanData(token);

    const fileKey = `${user.id}/${fileName}`;
    const supabase = createSupabaseAdminClient();
    const { data: existingRecord, error: fetchError } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', user.id)
      .eq('file_key', fileKey)
      .limit(1)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      return res.status(500).json({ error: fetchError.message });
    }
    let objSize = size;
    let insertedId: string | null = null;
    if (existingRecord) {
      objSize = existingRecord.file_size;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('files')
        .insert([
          {
            user_id: user.id,
            book_hash: bookHash ?? null,
            replica_kind: replicaKind ?? null,
            replica_id: replicaId ?? null,
            file_key: fileKey,
            file_size: size,
          },
        ])
        .select()
        .single();
      if (insertError) return res.status(500).json({ error: insertError.message });
      insertedId = inserted?.id ?? null;
    }

    const dropInserted = async () => {
      if (insertedId) await supabase.from('files').delete().eq('id', insertedId);
    };
    const usage = await readStorageUsage(supabase, user.id);
    if (!Number.isFinite(usage)) {
      await dropInserted();
      return res.status(503).json({ error: 'Storage usage unavailable' });
    }
    if (usage > quota + STORAGE_QUOTA_GRACE_BYTES) {
      await dropInserted();
      return res.status(403).json({
        error: 'Insufficient storage quota',
        usage: insertedId ? usage - size : usage,
      });
    }

    try {
      const uploadUrl = await getUploadSignedUrl(fileKey, objSize, 1800);

      res.status(200).json({
        uploadUrl,
        fileKey,
        usage,
        quota,
      });
    } catch (error) {
      console.error('Error creating presigned post:', error);
      res.status(500).json({ error: 'Could not create presigned post' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
