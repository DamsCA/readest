import { isWebAppPlatform } from '@/services/environment';

// The welcome tour of the web reader (owner's ask, 26 Nov 2026: « si j'envoie
// le lien vers ma liseuse, la personne arrive sur la liseuse et elle a le
// guide… je parle de la version web »). The same tour as the phone app
// (lisetlead-app/src/app/bienvenue.tsx): her lines word for word, her
// recordings, the same demo page. Its scene is components/Tutoriel.tsx.

/** Remembered in the browser: the tour has been shown (it opens by itself once). */
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
};

// While the tour is on screen, the sign-up window waits (InvitationInscription).
let ouvert = false;
export const tutorielOuvert = () => ouvert;
export const noterTutorielOuvert = (valeur: boolean) => {
  ouvert = valeur;
};

/**
 * A first visit to the reader on this browser? Web only. A visitor sent back
 * from TikTok or Instagram to their own browser (?depuis=appli, by the sign-up
 * window) has already had the tour there.
 */
export const premiereVisite = () => {
  if (!isWebAppPlatform()) return false;
  try {
    if (localStorage.getItem(CLE_TUTORIEL_VU)) return false;
    if (new URLSearchParams(window.location.search).get('depuis') === 'appli') {
      marquerTutorielVu();
      return false;
    }
    return true;
  } catch {
    // No storage (some private windows): the tour would come back on every
    // page, so it is not shown by itself.
    return false;
  }
};

export const marquerTutorielVu = () => {
  try {
    localStorage.setItem(CLE_TUTORIEL_VU, new Date().toISOString().slice(0, 10));
  } catch {}
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
