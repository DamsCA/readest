import { isWebAppPlatform } from '@/services/environment';

// The welcome tour of the web reader (owner's ask, 26 Nov 2026: « si j'envoie
// le lien vers ma liseuse, la personne arrive sur la liseuse et elle a le
// guide… je parle de la version web »). The same tour as the phone app
// (lisetlead-app/src/app/bienvenue.tsx): her lines word for word, her
// recordings, the same demo page. Its scene is components/Tutoriel.tsx.

/**
 * Remembered in the browser: the tour has been shown. Without a suffix for a
 * visitor (the key the tour has used since 26 Nov 2026), `:<id>` for an account.
 */
export const CLE_TUTORIEL_VU = 'lel-tutoriel-vu';
/** « Couper le son »: her voice stays off, between visits. */
export const CLE_SON_COUPE = 'lel-tutoriel-son-coupe';

/** Sent by the settings menu (« Revoir le tutoriel »). */
export const TUTORIEL_REVOIR = 'lel-tutoriel-revoir';
/** Sent when the tour closes; read by InvitationInscription. */
export const TUTORIEL_FERME = 'lel-tutoriel-ferme';
export type FinTutoriel = {
  /** « Recevoir mon livre »: the sign-up window opens at once. */
  inscription: boolean;
  /** The gift step was shown: the sign-up window does not pop up again this visit. */
  cadeauVu: boolean;
  /** The tour sends the reader to another page (« Découvrir Plus »). */
  ailleurs: boolean;
};

// While the tour is on screen, the sign-up window waits (InvitationInscription).
let ouvert = false;
export const tutorielOuvert = () => ouvert;
export const noterTutorielOuvert = (valeur: boolean) => {
  ouvert = valeur;
};

// The order of a first visit (owner's asks, 27 Nov 2026: « Je tape juste le
// lien… et directement je tombe sur l'onboarding. C'est problématique », then
// « Il n'est pas obligé de s'inscrire. Mais lorsqu'il fait plus tard, je vais
// d'abord, il a le droit à son onboarding », and the spotlights « au bon
// moment… il faut un moment précis »):
// 1. the gift window first (InvitationInscription), never forced;
// 2. the tour right after it: after « Plus tard, je visite d'abord » for a
//    visitor, after the sign-up for a new account; once per person here;
// 3. after a sign-up, the gift that opens « Ça marche » (WelcomeGift);
// 4. the first book opened after the tour: the reader's tour
//    (reader/components/VisiteLecteur.tsx), once. Never before the tour.

/** sessionStorage key and window event: the visitor closed the gift window. */
export const INVITATION_FERMEE = 'lel-invitation-fermee';

/** An account this young has just signed up: its first visit brings the tour. */
const NOUVEAU_COMPTE_MS = 24 * 60 * 60 * 1000;

/** Set when the tour ends: the next book opened brings the reader's tour. */
const CLE_VISITE_A_FAIRE = 'lel-visite-lecteur-a-faire';
/** The reader's tour has been shown (since 26 Nov 2026, without a suffix for a visitor). */
export const CLE_VISITE_VUE = 'lel-visite-lecteur-vue';

/** A key for a visitor (no account) or for one account. */
const cle = (base: string, userId?: string | null) => (userId ? `${base}:${userId}` : base);
const lire = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const ecrire = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const effacer = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {}
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const stockageOk = () => {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
};

type Compte = { id: string; created_at?: string } | null | undefined;

/** When the account was created, in ms (Supabase gives 6 decimals, kept to 3). */
const creeLe = (compte: NonNullable<Compte>) =>
  Date.parse((compte.created_at ?? '').replace(/(\.\d{3})\d+/, '$1'));

/** The visitor closed the gift window in this visit (« Plus tard »). */
export const invitationFermee = () => {
  try {
    return !!sessionStorage.getItem(INVITATION_FERMEE);
  } catch {
    return false;
  }
};

/** A visitor who has not had the tour on this browser. Web only. */
export const tutorielVisiteurAMontrer = () =>
  isWebAppPlatform() && stockageOk() && !lire(CLE_TUTORIEL_VU);

/**
 * The visitor who just signed up is the same person: what they did here as a
 * visitor (the tour, the reader's tour, or the one still due) becomes their
 * account's. The visitor keys go, so that another new account on this browser
 * later gets its own tour.
 */
const reprendreCommeCompte = (userId: string) => {
  for (const base of [CLE_TUTORIEL_VU, CLE_VISITE_A_FAIRE, CLE_VISITE_VUE]) {
    const valeur = lire(base);
    if (valeur === null) continue;
    if (lire(cle(base, userId)) === null) ecrire(cle(base, userId), valeur);
    effacer(base);
  }
};

/**
 * Does this account get the tour now? Web only, an account created in the last
 * 24 hours that has not had it here. If the person had it a moment ago as a
 * visitor on this browser, it is not played twice: it becomes the account's.
 * An older account signing in on a new device does not get it (« Revoir le
 * tutoriel » is in the menu).
 */
export const tutorielAMontrer = (compte: Compte) => {
  if (!compte || !isWebAppPlatform() || !stockageOk()) return false;
  const cree = creeLe(compte);
  if (!Number.isFinite(cree) || Date.now() - cree > NOUVEAU_COMPTE_MS) return false;
  if (lire(cle(CLE_TUTORIEL_VU, compte.id))) return false;
  if (lire(CLE_TUTORIEL_VU)) {
    reprendreCommeCompte(compte.id);
    return false;
  }
  return true;
};

/** The tour opens now: for this account, or for a visitor (null). */
export const marquerTutorielVu = (userId: string | null) =>
  ecrire(cle(CLE_TUTORIEL_VU, userId), aujourdhui());

/** The tour has ended: the next book opened brings the reader's tour. */
export const noterVisiteLecteurAFaire = (userId: string | null) =>
  ecrire(cle(CLE_VISITE_A_FAIRE, userId), '1');

/** The reader's tour is due now (the tour has ended, and it has not been shown). */
export const visiteLecteurAFaire = (userId: string | null) =>
  lire(cle(CLE_VISITE_A_FAIRE, userId)) === '1' && !lire(cle(CLE_VISITE_VUE, userId));

/** The reader's tour is shown: never again for this person here. */
export const visiteLecteurFaite = (userId: string | null) => {
  effacer(cle(CLE_VISITE_A_FAIRE, userId));
  ecrire(cle(CLE_VISITE_VUE, userId), aujourdhui());
};

export const lireSonCoupe = () => {
  try {
    return localStorage.getItem(CLE_SON_COUPE) === '1';
  } catch {
    return false;
  }
};

export const garderSonCoupe = (coupe: boolean) => {
  try {
    localStorage.setItem(CLE_SON_COUPE, coupe ? '1' : '0');
  } catch {}
};

// ---------- Her poses (the bookmark mascot, transparent pictures) ----------

const MASCOTTE = '/tutoriel/marque-page';
export const POSES = {
  eveil: `${MASCOTTE}-salut-bleu-nuit.webp`,
  montre: `${MASCOTTE}-montre.webp`,
  complice: `${MASCOTTE}-complice.webp`,
  ecoute: `${MASCOTTE}-ecoute.webp`,
  cadeau: `${MASCOTTE}-cadeau.webp`,
  confiante: `${MASCOTTE}-fier.webp`,
} as const;
export type Pose = keyof typeof POSES;

// ---------- Her lines, word for word (lisetlead-app/src/lib/tutoriel.ts) ----------

// Non-breaking space: French punctuation (« », ?, !, :) never starts a line.
const E = ' ';
const VOIX = '/tutoriel/voix';

export type RepliqueId = 'l1' | 'l2' | 'l3' | 'l4a' | 'l4b' | 'l5' | 'l6';

export const REPLIQUES: Record<RepliqueId, { texte: string; voix: string }> = {
  l1: {
    texte:
      'Les plus grands livres du monde ne sont pas écrits en français. Moi, je vais vous les ouvrir.',
    voix: `${VOIX}/l1-eveil.mp3`,
  },
  l2: {
    texte: `Voici une page en anglais. Touchez «${E}Traduire${E}».`,
    voix: `${VOIX}/l2-page.mp3`,
  },
  l3: {
    texte: `Voyez la différence${E}? Le sens, le ton, les expressions. C'est ça, lire avec Plus.`,
    voix: `${VOIX}/l3-difference.mp3`,
  },
  l4a: {
    texte: 'Et quand vos yeux fatiguent… écoutez.',
    voix: `${VOIX}/l4a-ecoutez.mp3`,
  },
  l4b: {
    texte: `Cette voix, vous l'entendez depuis le début. C'est la voix Plus. Elle peut vous lire n'importe quel livre${E}: dans les transports, au sport, au lit.`,
    voix: `${VOIX}/l4b-revelation.mp3`,
  },
  l5: {
    texte: `Et pour bien commencer, un cadeau${E}: «${E}Ça marche${E}», le célèbre petit livre rouge de 1926. Il est à vous.`,
    voix: `${VOIX}/l5-cadeau.mp3`,
  },
  l6: {
    texte: 'Vous venez de goûter à Plus. Avec Plus, je vous accompagne dans chaque livre.',
    voix: `${VOIX}/l6-plus.mp3`,
  },
};

/** The demo page of step 4, read whole by the Plus voice (its text is `plus` in tutoriel-demo.json). */
export const PAGE_LUE = `${VOIX}/l4-page-lue.mp3`;

// Where each sentence starts in l4-page-lue.mp3, in seconds, measured on the
// recording's pauses (22.73 s long); scaled to the real length when it plays.
export const DUREE_PAGE_LUE = 22.73;
export const DEBUTS_PAGE_LUE = [0, 5.67, 10.76, 15.53, 19.63, 21.15];
