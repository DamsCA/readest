import { getSubscriptionPlan, validateUserAndToken } from '@/utils/access';
import { r2Storage } from '@/utils/r2';
import { CATALOGUE } from '@/libs/ouiread/catalogue';

// POST { id } -> a link to the book, valid ten minutes, for Plus readers only
// (owner's rule, 28 Nov 2026: « il faut s'abonner pour pouvoir avoir accès au
// catalogue »). The books sit in the private bucket under catalogue/<id>.epub
// (libs/ouiread/catalogue.ts). Used by the site and by the phone app.
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(req: Request): Promise<Response> {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return json(401, { error: 'NOT_AUTHENTICATED' });
  if (getSubscriptionPlan(token) === 'free') return json(402, { error: 'PLUS_REQUIRED' });

  let id = '';
  try {
    const body = (await req.json()) as { id?: unknown };
    id = typeof body.id === 'string' ? body.id : '';
  } catch {
    return json(400, { error: 'invalid json' });
  }
  const livre = CATALOGUE.find((l) => l.id === id);
  if (!livre) return json(404, { error: 'UNKNOWN_BOOK' });

  const bucket = process.env['R2_BUCKET_NAME'];
  if (!bucket) return json(503, { error: 'catalogue unavailable' });
  const url = await r2Storage.getDownloadSignedUrl(bucket, `catalogue/${livre.id}.epub`, 600);
  return json(200, { url, fileName: `${livre.title}.epub`, hash: livre.hash });
}
