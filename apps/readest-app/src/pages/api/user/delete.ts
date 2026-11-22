import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const supabaseAdmin = createSupabaseAdminClient();

    // Ouiread: the reader's files go with the account. The database rows are
    // removed by ON DELETE CASCADE, but the objects in the bucket are not, so
    // delete every object this account still references before the account.
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: files, error: filesError } = await supabaseAdmin
        .from('files')
        .select('file_key')
        .eq('user_id', user.id)
        .range(offset, offset + PAGE - 1);
      if (filesError) {
        return res.status(500).json({ error: filesError.message });
      }
      for (const { file_key } of files ?? []) {
        try {
          await deleteObject(file_key);
        } catch (objectError) {
          console.error('Account deletion: could not delete', file_key, objectError);
        }
      }
      if (!files || files.length < PAGE) break;
    }

    // The public avatar (api/profile/avatar) is not in the files table.
    try {
      await deleteObject(`avatars/${user.id}`);
    } catch (objectError) {
      console.error('Account deletion: could not delete the avatar', objectError);
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
