import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';
import { appleRevoke, appleSignInConfigured } from '@/utils/appleSignIn';

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

    // A paid subscription must not outlive the account (Stripe would keep
    // charging a reader who can no longer sign in): cancel it now.
    try {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (customer?.stripe_customer_id) {
        // Plain Stripe REST calls: the stripe package is not bundled for the
        // pages router on Cloudflare Workers.
        const key = process.env['STRIPE_SECRET_KEY'];
        const auth = { Authorization: `Bearer ${key}` };
        const list = await fetch(
          `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customer.stripe_customer_id)}&status=all&limit=20`,
          { headers: auth },
        );
        if (!list.ok) throw new Error(`Stripe list failed (${list.status})`);
        const { data } = (await list.json()) as { data: { id: string; status: string }[] };
        for (const subscription of data) {
          if (
            ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(subscription.status)
          ) {
            const cancel = await fetch(
              `https://api.stripe.com/v1/subscriptions/${subscription.id}`,
              {
                method: 'DELETE',
                headers: auth,
              },
            );
            if (!cancel.ok) throw new Error(`Stripe cancel failed (${cancel.status})`);
          }
        }
      }
    } catch (stripeError) {
      console.error('Account deletion: could not cancel the subscription', stripeError);
      return res.status(500).json({ error: 'Could not cancel the subscription' });
    }

    // Sign in with Apple: revoke the authorization (App Store rule 5.1.1(v)).
    // A failure must not keep the reader from deleting the account.
    try {
      const { data: apple } = await supabaseAdmin
        .from('apple_tokens')
        .select('refresh_token')
        .eq('user_id', user.id)
        .maybeSingle();
      if (apple?.refresh_token && appleSignInConfigured()) {
        await appleRevoke(apple.refresh_token);
      }
    } catch (appleError) {
      console.error('Account deletion: could not revoke Sign in with Apple', appleError);
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
