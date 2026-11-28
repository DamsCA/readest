import { getAccessToken, getSubscriptionPlan } from '@/utils/access';
import { CATALOGUE, type LivreCatalogue } from './catalogue';

export type StatutLecteur = 'anonyme' | 'gratuit' | 'plus';

/** Who is reading: no account, a free account, or a Plus subscriber. */
export const statutLecteur = async (): Promise<StatutLecteur> => {
  const token = await getAccessToken();
  if (!token) return 'anonyme';
  return getSubscriptionPlan(token) === 'free' ? 'gratuit' : 'plus';
};

export type Telechargement =
  | { ok: true; livre: LivreCatalogue; fichier: File }
  | { ok: false; raison: 'connexion' | 'plus' | 'reseau' };

/** A catalogue book as a File, for Plus readers (the server checks the plan). */
export const telechargerLivre = async (id: string): Promise<Telechargement> => {
  const livre = CATALOGUE.find((l) => l.id === id);
  if (!livre) return { ok: false, raison: 'reseau' };
  const token = await getAccessToken();
  if (!token) return { ok: false, raison: 'connexion' };
  try {
    const reponse = await fetch('/api/catalogue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (reponse.status === 401) return { ok: false, raison: 'connexion' };
    if (reponse.status === 402) return { ok: false, raison: 'plus' };
    if (!reponse.ok) return { ok: false, raison: 'reseau' };
    const { url } = (await reponse.json()) as { url?: string };
    if (!url) return { ok: false, raison: 'reseau' };
    const contenu = await fetch(url);
    if (!contenu.ok) return { ok: false, raison: 'reseau' };
    const fichier = new File([await contenu.blob()], `${livre.title}.epub`, {
      type: 'application/epub+zip',
    });
    return { ok: true, livre, fichier };
  } catch {
    return { ok: false, raison: 'reseau' };
  }
};

/** Where a reader goes when the book is locked: sign-up first, then the Plus offer. */
export const pageDeverrouillage = (statut: StatutLecteur, id: string) =>
  statut === 'anonyme'
    ? `/auth?inscription=1&redirect=${encodeURIComponent(`/library?livre=${id}`)}`
    : '/user';
