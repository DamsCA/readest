import { NextRequest } from 'next/server';

// Apple posts its sign-in answer here (response_mode form_post, see
// app/auth/utils/appleWeb.ts). The ID token is handed on to /auth/apple in the
// URL fragment, which never reaches a server; that page checks the state and
// opens the session with Supabase. Nothing is kept here.

export const dynamic = 'force-dynamic';

const texte = (value: FormDataEntryValue | null) =>
  typeof value === 'string' ? value.slice(0, 4096) : '';

export async function POST(req: NextRequest) {
  let corps: FormData | null = null;
  try {
    corps = await req.formData();
  } catch {
    corps = null;
  }
  const fragment = new URLSearchParams();
  const erreur = texte(corps?.get('error') ?? null);
  if (erreur) fragment.set('error', erreur);
  const idToken = texte(corps?.get('id_token') ?? null);
  if (idToken) fragment.set('id_token', idToken);
  fragment.set('state', texte(corps?.get('state') ?? null));
  const retour = new URL('/auth/apple', req.url);
  retour.hash = fragment.toString();
  // 303: the browser follows with a GET, as after any form.
  return new Response(null, {
    status: 303,
    headers: { Location: retour.toString(), 'Cache-Control': 'no-store' },
  });
}
