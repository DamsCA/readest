'use client';

import clsx from 'clsx';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { PiArrowRightBold, PiSpeakerHighDuotone, PiSpeakerSlashDuotone } from 'react-icons/pi';
import { isWebAppPlatform } from '@/services/environment';
import { isTranslationAvailable } from '@/services/translators/utils';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { mesurer } from '@/utils/mesure';
import { garderSonCoupe, lireSonCoupe, POSES, type Pose } from '@/app/library/utils/tutoriel';

// The reader's tour (owner's ask, 26 Nov 2026: « lorsqu'il va cliquer sur
// Ça marche … tu vas faire des spotlights sur les boutons pour voir comment il
// l'utilise »). The first time a book opens on a phone-sized screen, the
// bookmark lights the reader's real buttons one at a time: Traduire, Écouter,
// the contents, the text settings, then how to turn a page. « Passer » is
// always there. Web only; once per browser.

/** Remembered in the browser: the reader's tour has been shown. */
export const CLE_VISITE_VUE = 'lel-visite-lecteur-vue';

// Non-breaking space: French punctuation (« », ?, !, :) never starts a line.
const E = ' ';
const VOIX = '/tutoriel/voix';

type Cible = 'traduire' | 'ecouter' | 'sommaire' | 'texte' | 'pages';
type Etape = { cible: Cible; texte: string; voix: string; pose: Pose };

const etapes = (dejaEnFrancais: boolean): Etape[] => [
  dejaEnFrancais
    ? {
        cible: 'traduire',
        texte: `Votre livre est ouvert${E}! Ce bouton traduit en français vos livres en anglais. Celui-ci est déjà en français.`,
        voix: `${VOIX}/v1a-traduire.mp3`,
        pose: 'eveil',
      }
    : {
        cible: 'traduire',
        texte: `Votre livre est ouvert${E}! Touchez ce bouton, et il passe en français.`,
        voix: `${VOIX}/v1b-traduire.mp3`,
        pose: 'eveil',
      },
  {
    cible: 'ecouter',
    texte: 'Ici, le livre vous est lu à voix haute. Pratique quand vos yeux fatiguent.',
    voix: `${VOIX}/v2-ecouter.mp3`,
    pose: 'ecoute',
  },
  {
    cible: 'sommaire',
    texte: `Le sommaire${E}: pour aller droit au chapitre de votre choix.`,
    voix: `${VOIX}/v3-sommaire.mp3`,
    pose: 'montre',
  },
  {
    cible: 'texte',
    texte: 'Ici, vous réglez la taille du texte et l’espace entre les lignes.',
    voix: `${VOIX}/v4-texte.mp3`,
    pose: 'complice',
  },
  {
    cible: 'pages',
    texte: `Touchez à droite pour tourner la page, à gauche pour revenir. Au milieu, vos boutons réapparaissent. Bonne lecture${E}!`,
    voix: `${VOIX}/v5-pages.mp3`,
    pose: 'confiante',
  },
];

type Rect = { x: number; y: number; l: number; h: number };

/** Where a step's button is on screen, or null while it is not there. */
const trouver = (cible: Cible): Rect | null => {
  if (cible === 'pages') {
    // The whole page: its three tap zones are drawn on it (see Zones).
    return { x: 0, y: 0, l: window.innerWidth, h: window.innerHeight };
  }
  const el =
    cible === 'traduire'
      ? document.querySelector<HTMLElement>('.lel-tuto-traduire')
      : document.querySelector<HTMLElement>(`[data-tuto="${cible}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) return null;
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    l: Math.round(r.width),
    h: Math.round(r.height),
  };
};

const memes = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.l === b.l && a.h === b.h);

/** A first book on this browser, on a phone-sized screen? */
const premiereOuverture = () => {
  if (!isWebAppPlatform() || window.innerWidth >= 640) return false;
  try {
    return !localStorage.getItem(CLE_VISITE_VUE);
  } catch {
    // No storage: it would come back with every book, so it is not shown.
    return false;
  }
};

const marquerVue = () => {
  try {
    localStorage.setItem(CLE_VISITE_VUE, new Date().toISOString().slice(0, 10));
  } catch {}
};

export default function VisiteLecteur({ bookKey }: { bookKey: string }) {
  const [ouverte, setOuverte] = useState(false);
  const { getBookData } = useBookDataStore();
  const { getViewSettings } = useReaderStore();

  useEffect(() => {
    if (!premiereOuverture()) return undefined;
    // Let the page and its bars settle first.
    let essais = 0;
    const minuterie = window.setInterval(() => {
      essais++;
      if (document.querySelector('.lel-tuto-traduire') || essais > 20) {
        window.clearInterval(minuterie);
        if (!document.querySelector('.lel-tuto-traduire')) return;
        marquerVue();
        setOuverte(true);
      }
    }, 300);
    return () => window.clearInterval(minuterie);
  }, []);

  if (!ouverte) return null;
  const book = getBookData(bookKey)?.book;
  const reglages = getViewSettings(bookKey);
  const dejaEnFrancais = !isTranslationAvailable(
    book,
    reglages?.translateTargetLang,
    reglages?.translationProvider,
  );
  // On document.body: the reader's own containers would trap a fixed overlay.
  return createPortal(
    <Visite bookKey={bookKey} dejaEnFrancais={dejaEnFrancais} onFin={() => setOuverte(false)} />,
    document.body,
  );
}

function Visite({
  bookKey,
  dejaEnFrancais,
  onFin,
}: {
  bookKey: string;
  dejaEnFrancais: boolean;
  onFin: () => void;
}) {
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const [liste] = useState(() => etapes(dejaEnFrancais));
  const [n, setN] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [coupe, setCoupe] = useState(lireSonCoupe);
  const lecteur = useRef<HTMLAudioElement | null>(null);
  const enAttente = useRef(false);
  const finie = useRef(false);
  const bulle = useRef<HTMLDivElement>(null);
  const [hauteurBulle, setHauteurBulle] = useState(0);
  const etape = liste[n]!;
  const avecBarres = etape.cible !== 'pages';

  // Her bars stay in view while their buttons are shown; hidden for the page.
  useEffect(() => {
    if (avecBarres && hoveredBookKey !== bookKey) setHoveredBookKey(bookKey);
    if (!avecBarres && hoveredBookKey) setHoveredBookKey(null);
  }, [avecBarres, hoveredBookKey, bookKey, setHoveredBookKey]);

  useEffect(() => {
    mesurer('visite_vue');
  }, []);

  useLayoutEffect(() => {
    setHauteurBulle(bulle.current?.offsetHeight ?? 0);
  }, [n]);

  // Follows the button (the bars slide in, the screen may turn).
  useEffect(() => {
    let image = 0;
    let dernier: Rect | null = null;
    let absent = 0;
    const suivre = () => {
      const r = trouver(etape.cible);
      if (!memes(r, dernier)) {
        dernier = r;
        setRect(r);
      }
      // A button that never shows (contents pinned aside…): its step is skipped.
      absent = r ? 0 : absent + 1;
      if (absent > 120) {
        setN((k) => Math.min(k + 1, liste.length - 1));
        return;
      }
      image = window.requestAnimationFrame(suivre);
    };
    image = window.requestAnimationFrame(suivre);
    return () => window.cancelAnimationFrame(image);
  }, [etape.cible, liste.length]);

  const jouer = useCallback(
    (source: string) => {
      if (coupe) return;
      if (!lecteur.current) {
        lecteur.current = new Audio();
        lecteur.current.preload = 'auto';
      }
      const a = lecteur.current;
      a.src = source;
      a.play().then(
        () => {
          enAttente.current = false;
        },
        // The browser keeps the page silent until it is touched: her line plays at the first tap.
        // (An AbortError only means a newer line took its place.)
        (e: unknown) => {
          if (e instanceof DOMException && e.name === 'NotAllowedError') enAttente.current = true;
        },
      );
    },
    [coupe],
  );

  useEffect(() => {
    jouer(etape.voix);
  }, [etape.voix, jouer]);

  useEffect(
    () => () => {
      lecteur.current?.pause();
      lecteur.current = null;
    },
    [],
  );

  const finir = (passe: boolean) => {
    if (finie.current) return;
    finie.current = true;
    lecteur.current?.pause();
    mesurer(passe ? `visite_passe_${n + 1}` : 'visite_fin');
    setHoveredBookKey(null);
    onFin();
  };

  const suivant = () => {
    if (n + 1 >= liste.length) finir(false);
    else setN(n + 1);
  };

  const basculerSon = () => {
    const c = !coupe;
    setCoupe(c);
    garderSonCoupe(c);
    if (c) lecteur.current?.pause();
  };

  // Her bubble goes where there is the most room, its tip toward the button.
  const L = window.innerWidth;
  const H = window.innerHeight;
  const largeur = Math.min(L - 24, 420);
  const gauche = Math.round((L - largeur) / 2);
  const marge = 8;
  let place: CSSProperties = { top: H * 0.3 };
  let pointe: 'haut' | 'bas' | null = null;
  let pointeX = largeur / 2;
  if (rect) {
    const dessous = H - (rect.y + rect.h);
    pointeX = Math.max(26, Math.min(largeur - 26, rect.x + rect.l / 2 - gauche));
    if (etape.cible === 'pages') {
      // Above the page's lit part, at the top of the screen.
      place = { top: 16 };
      pointe = null;
    } else if (dessous >= rect.y) {
      place = { top: rect.y + rect.h + marge + 14 };
      pointe = 'haut';
    } else {
      place = { bottom: H - rect.y + marge + 14 };
      pointe = 'bas';
    }
  }

  return (
    <div
      className='visite'
      role='dialog'
      aria-modal='true'
      aria-label='Les boutons du lecteur'
      onPointerDown={() => {
        if (enAttente.current) jouer(etape.voix);
      }}
    >
      <style>{STYLES}</style>
      {etape.cible === 'pages' ? (
        <>
          <div className='visite__voile visite__voile--leger' aria-hidden />
          <Zones haut={16 + hauteurBulle + 16} />
        </>
      ) : rect ? (
        <div
          key={etape.cible}
          className='visite__projecteur'
          style={{
            left: rect.x - marge,
            top: rect.y - marge,
            width: rect.l + marge * 2,
            height: rect.h + marge * 2,
          }}
          aria-hidden
        />
      ) : (
        <div className='visite__voile' aria-hidden />
      )}

      <div
        key={n}
        ref={bulle}
        className='visite__bulle'
        style={{ ...place, left: gauche, width: largeur }}
      >
        {pointe && (
          <span
            className={clsx('visite__pointe', `visite__pointe--${pointe}`)}
            style={{ left: pointeX - 8 }}
            aria-hidden
          />
        )}
        <div className='visite__ligne'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className='visite__mascotte' src={POSES[etape.pose]} alt='' width={64} height={64} />
          <p className='visite__texte' aria-live='polite'>
            {etape.texte}
          </p>
        </div>
        <div className='visite__bas'>
          <button
            type='button'
            className='visite__pastille'
            aria-label={coupe ? 'Remettre le son' : 'Couper le son'}
            onClick={basculerSon}
          >
            {coupe ? (
              <PiSpeakerSlashDuotone size={18} aria-hidden />
            ) : (
              <PiSpeakerHighDuotone size={18} aria-hidden />
            )}
          </button>
          <span
            className='visite__points'
            role='img'
            aria-label={`Étape ${n + 1} sur ${liste.length}`}
          >
            {liste.map((e, i) => (
              <span
                key={e.cible}
                className={clsx('visite__point', i === n && 'visite__point--actuel')}
              />
            ))}
          </span>
          <span className='visite__boutons'>
            {n + 1 < liste.length && (
              <button type='button' className='visite__passer' onClick={() => finir(true)}>
                Passer
              </button>
            )}
            <button type='button' className='visite__suivant' onClick={suivant}>
              {n + 1 < liste.length ? (
                <>
                  Suivant
                  <PiArrowRightBold size={16} aria-hidden />
                </>
              ) : (
                'C’est parti'
              )}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The page's three tap zones (usePagination): the left goes back, the middle
 * (37.5 % to 62.5 % of the width) brings the bars back, the right turns the page.
 */
function Zones({ haut }: { haut: number }) {
  return (
    <div className='visite__zones' style={{ top: haut }} aria-hidden>
      <div className='visite__zone' style={{ width: '37.5%' }}>
        <span className='visite__etiquette'>‹ Revenir</span>
      </div>
      <div className='visite__zone visite__zone--milieu' style={{ width: '25%' }}>
        <span className='visite__etiquette'>Vos boutons</span>
      </div>
      <div className='visite__zone visite__zone--avancer' style={{ width: '37.5%' }}>
        <span className='visite__etiquette visite__etiquette--or'>Avancer ›</span>
        <span className='visite__doigt' />
      </div>
    </div>
  );
}

const STYLES = `
.visite {
  position: fixed; inset: 0; z-index: 9999;
  font-family: 'DM Sans Variable', ui-sans-serif, system-ui, sans-serif;
  -webkit-tap-highlight-color: transparent; touch-action: none;
}
.visite button { font-family: inherit; cursor: pointer; }
.visite button:focus-visible { outline: 3px solid #F2C14E; outline-offset: 3px; }
.visite__voile { position: absolute; inset: 0; background: rgba(7,10,18,0.74); }
.visite__projecteur {
  position: absolute; border-radius: 16px;
  box-shadow: 0 0 0 200vmax rgba(7,10,18,0.74);
  outline: 2px solid #F2C14E; outline-offset: 0;
  transition: left .35s ease, top .35s ease, width .35s ease, height .35s ease;
  animation: visite-halo 1.6s ease-in-out infinite;
  pointer-events: none;
}
.visite__voile--leger { background: rgba(7,10,18,0.55); }
.visite__zones {
  position: absolute; left: 8px; right: 8px; bottom: 20px;
  display: flex; gap: 6px; pointer-events: none;
}
.visite__zone {
  position: relative; box-sizing: border-box; border-radius: 18px;
  border: 2px dashed rgba(244,235,221,0.45); background: rgba(255,248,235,0.06);
  display: flex; align-items: center; justify-content: center;
}
.visite__zone--avancer { border: 2px solid #F2C14E; background: rgba(242,193,78,0.14); animation: visite-halo 1.6s ease-in-out infinite; }
.visite__etiquette {
  padding: 6px 10px; border-radius: 999px; background: #111726; color: #F4EBDD;
  font-size: 13px; font-weight: 600; white-space: nowrap;
}
.visite__etiquette--or { background: #F2C14E; color: #241A06; }
.visite__zone--avancer .visite__doigt { top: auto; bottom: 22%; margin-top: 0; }
@keyframes visite-halo {
  0%, 100% { outline-color: rgba(242,193,78,1); border-color: rgba(242,193,78,1); }
  50% { outline-color: rgba(242,193,78,0.45); border-color: rgba(242,193,78,0.45); }
}
.visite__doigt {
  position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 999px; background: rgba(242,193,78,0.35); border: 2px solid #F2C14E;
  animation: visite-touche 1.6s ease-in-out infinite;
}
@keyframes visite-touche {
  0%, 100% { transform: scale(0.8); opacity: .55; }
  45% { transform: scale(1.08); opacity: 1; }
}
.visite__bulle {
  position: absolute; box-sizing: border-box;
  background: #111726; border: 1px solid rgba(242,193,78,0.30); border-radius: 22px;
  padding: 14px 14px 12px; box-shadow: 0 14px 36px rgba(0,0,0,0.45);
  animation: visite-fondu .38s ease both;
}
@keyframes visite-fondu { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.visite__pointe {
  position: absolute; width: 16px; height: 16px; background: #111726;
  border: 1px solid rgba(242,193,78,0.30); transform: rotate(45deg);
}
.visite__pointe--haut { top: -9px; border-right: 0; border-bottom: 0; }
.visite__pointe--bas { bottom: -9px; border-left: 0; border-top: 0; }
.visite__ligne { display: flex; align-items: center; gap: 12px; }
.visite__mascotte { width: 64px; height: 64px; object-fit: contain; flex: none; }
.visite__texte {
  margin: 0; color: #F4EBDD; font-size: 16.5px; line-height: 1.42;
  font-family: 'Source Serif 4', ui-serif, Georgia, 'Times New Roman', serif;
}
.visite__bas { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.visite__pastille {
  width: 36px; height: 36px; border-radius: 999px; border: 0; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,248,235,0.08); color: #F4EBDD;
}
.visite__points { display: flex; gap: 5px; flex: 1; }
.visite__point { width: 6px; height: 6px; border-radius: 999px; background: rgba(244,235,221,0.28); transition: width .25s ease; }
.visite__point--actuel { width: 16px; background: #F2C14E; }
.visite__boutons { display: flex; align-items: center; gap: 6px; }
.visite__passer {
  height: 38px; padding: 0 12px; border: 0; border-radius: 999px; background: none;
  color: rgba(244,235,221,0.72); font-size: 14.5px; font-weight: 500;
}
.visite__suivant {
  height: 40px; padding: 0 16px; border: 0; border-radius: 999px;
  display: flex; align-items: center; gap: 6px;
  background: #F2C14E; color: #241A06; font-size: 15px; font-weight: 700;
}
.visite__suivant:active { opacity: .88; }
.visite__pastille:active, .visite__passer:active { background: rgba(255,248,235,0.14); }
@media (prefers-reduced-motion: reduce) {
  .visite__projecteur, .visite__doigt, .visite__bulle, .visite__zone--avancer { animation: none; transition: none; }
}
`;
