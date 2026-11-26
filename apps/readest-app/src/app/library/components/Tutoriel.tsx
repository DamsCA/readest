'use client';

import clsx from 'clsx';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { IconType } from 'react-icons';
import {
  PiArrowRightBold,
  PiCloudCheckDuotone,
  PiDeviceMobileDuotone,
  PiGiftDuotone,
  PiHeadphonesDuotone,
  PiPauseFill,
  PiSparkleFill,
  PiSpeakerHighDuotone,
  PiSpeakerSlashDuotone,
  PiStopFill,
  PiTranslateDuotone,
} from 'react-icons/pi';
import { useAuth } from '@/context/AuthContext';
import { mesurer } from '@/utils/mesure';
import demo from '../utils/tutoriel-demo.json';
import {
  DEBUTS_PAGE_LUE,
  DUREE_PAGE_LUE,
  type FinTutoriel,
  garderSonCoupe,
  lireSonCoupe,
  marquerTutorielVu,
  noterTutorielOuvert,
  PAGE_LUE,
  type Pose,
  POSES,
  premiereVisite,
  REPLIQUES,
  type RepliqueId,
  TUTORIEL_FERME,
  TUTORIEL_REVOIR,
} from '../utils/tutoriel';

// The welcome tour of the web reader, the phone app's own (lisetlead-app/src/app/bienvenue.tsx):
// the bookmark wakes up, shows a page in English, translates it, reads it with
// the Plus voice, offers the welcome book, then presents Plus. « Passer » is
// always there. It opens by itself on a first visit to the reader (the
// library, at / and /library), and again from the settings menu.
//
// Browsers keep a page silent until it is touched: her first line shows
// without sound, and her voice starts with the first tap (« Montrez-moi »).

type Etape = 1 | 2 | 3 | 4 | 5 | 6;
type Lecture = 'aucune' | 'plus' | 'pause' | 'telephone';

const VISAGE: Record<Etape, Pose> = {
  1: 'eveil',
  2: 'montre',
  3: 'complice',
  4: 'ecoute',
  5: 'cadeau',
  6: 'confiante',
};

// The first three benefits of the app's Plus screen, titles only.
const BIENFAITS: { Icone: IconType; titre: string }[] = [
  { Icone: PiTranslateDuotone, titre: 'Une traduction digne d’un traducteur' },
  { Icone: PiHeadphonesDuotone, titre: 'Des voix qui donnent vie au livre' },
  { Icone: PiCloudCheckDuotone, titre: 'Toute votre bibliothèque en ligne' },
];

// The account first for a visitor, then the offers (as « Passer à Plus » in the settings menu).
const PAGE_PLUS = '/user';
const PAGE_PLUS_VISITEUR = '/auth?inscription=1&redirect=/user';

// ---------- The demo page read aloud ----------

const phrasesDe = (texte: string) =>
  texte.match(/[^.!?…]+[.!?…]+/g)?.map((s) => s.trim()) ?? [texte];
const PHRASES_PLUS = phrasesDe(demo.plus);
const DEBUTS_CARACTERES = PHRASES_PLUS.reduce<number[]>((debuts, ph) => {
  debuts.push(demo.plus.indexOf(ph, debuts.length ? debuts[debuts.length - 1]! : 0));
  return debuts;
}, []);

const phraseALaPosition = (caractere: number) => {
  let i = 0;
  while (i + 1 < DEBUTS_CARACTERES.length && caractere >= DEBUTS_CARACTERES[i + 1]!) i++;
  return i;
};

const phraseAuTemps = (secondes: number, duree: number) => {
  if (PHRASES_PLUS.length === DEBUTS_PAGE_LUE.length) {
    const echelle = duree > 0 ? duree / DUREE_PAGE_LUE : 1;
    let i = 0;
    while (i + 1 < DEBUTS_PAGE_LUE.length && secondes >= DEBUTS_PAGE_LUE[i + 1]! * echelle) i++;
    return i;
  }
  return phraseALaPosition(duree > 0 ? (secondes / duree) * demo.plus.length : 0);
};

// ---------- Her voice ----------

type OptionsVoix = {
  /** A demo the reader asks for himself plays even with her voice off. */
  forcer?: boolean;
  fin?: () => void;
  suivre?: (secondes: number, duree: number) => void;
  echec?: () => void;
};

/** One player for her lines, kept quiet while « son coupé » is on. */
function useVoix() {
  const lecteur = useRef<HTMLAudioElement | null>(null);
  const [coupe, setCoupe] = useState(lireSonCoupe);
  const coupeRef = useRef(coupe);
  const fin = useRef<(() => void) | null>(null);
  const suivi = useRef<((secondes: number, duree: number) => void) | null>(null);
  const jeton = useRef(0);

  const audio = useCallback(() => {
    if (!lecteur.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.addEventListener('timeupdate', () =>
        suivi.current?.(a.currentTime, Number.isFinite(a.duration) ? a.duration : 0),
      );
      a.addEventListener('ended', () => {
        const f = fin.current;
        fin.current = null;
        suivi.current = null;
        f?.();
      });
      lecteur.current = a;
    }
    return lecteur.current;
  }, []);

  useEffect(
    () => () => {
      fin.current = null;
      suivi.current = null;
      lecteur.current?.pause();
      lecteur.current = null;
    },
    [],
  );

  const arreter = useCallback(() => {
    jeton.current++;
    fin.current = null;
    suivi.current = null;
    lecteur.current?.pause();
  }, []);

  const jouer = useCallback(
    (source: string, options: OptionsVoix = {}) => {
      const n = ++jeton.current;
      fin.current = null;
      suivi.current = null;
      if (coupeRef.current && !options.forcer) {
        lecteur.current?.pause();
        return false;
      }
      const a = audio();
      a.src = source;
      fin.current = options.fin ?? null;
      suivi.current = options.suivre ?? null;
      a.play().catch(() => {
        if (jeton.current !== n) return;
        fin.current = null;
        suivi.current = null;
        options.echec?.();
      });
      return true;
    },
    [audio],
  );

  const pause = useCallback(() => lecteur.current?.pause(), []);
  const reprendre = useCallback(() => {
    lecteur.current?.play().catch(() => {});
  }, []);

  /** Turns her voice off or on; the choice is kept for next time. */
  const basculerSon = useCallback(() => {
    const c = !coupeRef.current;
    coupeRef.current = c;
    setCoupe(c);
    garderSonCoupe(c);
    if (c) arreter();
    return c;
  }, [arreter]);

  return { coupe, jouer, arreter, pause, reprendre, basculerSon };
}

const useEcran = () => {
  const lire = () => ({ largeur: Math.min(window.innerWidth, 480), hauteur: window.innerHeight });
  const [ecran, setEcran] = useState(lire);
  useEffect(() => {
    const maj = () => setEcran(lire());
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);
  return ecran;
};

// ---------- The tour ----------

export default function Tutoriel() {
  // null: closed; otherwise the key of this opening (each one starts over).
  const [ouverture, setOuverture] = useState<number | null>(null);

  useEffect(() => {
    if (premiereVisite()) {
      marquerTutorielVu();
      setOuverture(Date.now());
    }
    const revoir = () => setOuverture(Date.now());
    window.addEventListener(TUTORIEL_REVOIR, revoir);
    return () => window.removeEventListener(TUTORIEL_REVOIR, revoir);
  }, []);

  useEffect(() => {
    if (ouverture === null) return undefined;
    noterTutorielOuvert(true);
    return () => noterTutorielOuvert(false);
  }, [ouverture]);

  const finir = useCallback((fin: FinTutoriel) => {
    noterTutorielOuvert(false);
    setOuverture(null);
    window.dispatchEvent(new CustomEvent<FinTutoriel>(TUTORIEL_FERME, { detail: fin }));
  }, []);

  if (ouverture === null) return null;
  // On document.body: the library's own containers would trap a fixed overlay.
  return createPortal(<Scene key={ouverture} onFin={finir} />, document.body);
}

function Scene({ onFin }: { onFin: (fin: FinTutoriel) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const connecte = !!user;
  const voix = useVoix();
  const { jouer, arreter, pause, reprendre, basculerSon } = voix;
  const { largeur, hauteur } = useEcran();
  const [telephone] = useState(
    () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined',
  );

  const [etape, setEtape] = useState<Etape>(1);
  const [parle, setParle] = useState(false);
  const [traduction, setTraduction] = useState<'non' | 'en-cours' | 'oui'>('non');
  const [version, setVersion] = useState<'plus' | 'standard'>('plus');
  const [revelation, setRevelation] = useState(false);
  const [lecture, setLecture] = useState<Lecture>('aucune');
  const [phrase, setPhrase] = useState(-1);
  // Her lines play only after a first tap (the browser would refuse them before).
  const debloque = useRef(false);
  const cadeauVu = useRef(false);
  const ferme = useRef(false);
  const envoyes = useRef(new Set<string>());
  const jetonTelephone = useRef(0);
  const racine = useRef<HTMLDivElement>(null);
  const defile = useRef<HTMLDivElement>(null);

  const mesure = useCallback((evenement: string) => {
    if (envoyes.current.has(evenement)) return;
    envoyes.current.add(evenement);
    mesurer(evenement);
  }, []);

  const arreterTelephone = useCallback(() => {
    jetonTelephone.current++;
    try {
      window.speechSynthesis?.cancel();
    } catch {}
  }, []);

  useEffect(() => {
    mesure('tuto_vu');
    racine.current?.focus();
    return () => {
      jetonTelephone.current++;
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, [mesure]);

  // 1. She wakes up, then speaks (her first line, without sound until a tap).
  useEffect(() => {
    const t = setTimeout(() => setParle(true), 2100);
    return () => clearTimeout(t);
  }, []);

  const replique: RepliqueId | null =
    etape === 1
      ? parle
        ? 'l1'
        : null
      : etape === 2
        ? 'l2'
        : etape === 3
          ? 'l3'
          : etape === 4
            ? revelation
              ? 'l4b'
              : 'l4a'
            : etape === 5
              ? 'l5'
              : 'l6';

  // Played from the tap that brings each line, so that the browser allows it.
  const dire = useCallback(
    (id: RepliqueId) => {
      if (debloque.current) jouer(REPLIQUES[id].voix);
    },
    [jouer],
  );

  const silence = useCallback(() => {
    arreterTelephone();
    arreter();
  }, [arreter, arreterTelephone]);

  const aller = useCallback(
    (n: Etape) => {
      arreterTelephone();
      setLecture('aucune');
      setPhrase(-1);
      setEtape(n);
      if (n === 5 && !connecte) cadeauVu.current = true;
      if (n === 2) dire('l2');
      else if (n === 3) dire('l3');
      else if (n === 4) dire('l4a');
      else if (n === 5) dire('l5');
      else if (n === 6) dire('l6');
    },
    [arreterTelephone, connecte, dire],
  );

  useEffect(() => {
    defile.current?.scrollTo({ top: 0 });
  }, [etape]);

  const versLaPage = () =>
    requestAnimationFrame(() => {
      const zone = defile.current;
      zone?.scrollTo({ top: zone.scrollHeight, behavior: 'smooth' });
    });

  const fermer = useCallback(
    (options: { inscription?: boolean; vers?: string } = {}) => {
      if (ferme.current) return;
      ferme.current = true;
      silence();
      onFin({ inscription: !!options.inscription, cadeauVu: cadeauVu.current });
      if (options.vers) router.push(options.vers);
    },
    [onFin, router, silence],
  );

  const passer = useCallback(() => {
    if (ferme.current) return;
    mesure(`tuto_passe_${etape}`);
    fermer();
  }, [etape, fermer, mesure]);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') passer();
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [passer]);

  // 2. « Traduire »: the page turns French, then the difference is shown.
  useEffect(() => {
    if (traduction === 'en-cours') {
      const t = setTimeout(() => setTraduction('oui'), 700);
      return () => clearTimeout(t);
    }
    if (traduction === 'oui' && etape === 2) {
      const t = setTimeout(() => aller(3), 1800);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [traduction, etape, aller]);

  const montrer = () => {
    debloque.current = true;
    aller(2);
  };

  const traduire = () => {
    debloque.current = true;
    if (traduction !== 'non') return;
    mesure('tuto_traduire');
    setTraduction('en-cours');
  };

  // 3. Standard / Plus on the same page.
  const choisir = (v: 'plus' | 'standard') => {
    if (v !== version) mesure('tuto_difference');
    setVersion(v);
  };

  const reveler = () => {
    setLecture('aucune');
    setPhrase(-1);
    setRevelation(true);
    dire('l4b');
  };

  // 4. The Plus voice reads the page; the device's own voice can read it too.
  const ecouter = () => {
    debloque.current = true;
    if (lecture === 'plus') {
      pause();
      setLecture('pause');
      return;
    }
    if (lecture === 'pause') {
      reprendre();
      setLecture('plus');
      return;
    }
    arreterTelephone();
    mesure('tuto_ecouter');
    const lance = jouer(PAGE_LUE, {
      forcer: true,
      suivre: (secondes, duree) => setPhrase(phraseAuTemps(secondes, duree)),
      fin: reveler,
      echec: () => {
        setLecture('aucune');
        setPhrase(-1);
      },
    });
    if (lance) {
      setLecture('plus');
      setPhrase(0);
      versLaPage();
    }
  };

  const voixTelephone = () => {
    debloque.current = true;
    if (lecture === 'telephone') {
      arreterTelephone();
      setLecture('aucune');
      setPhrase(-1);
      return;
    }
    arreter();
    arreterTelephone();
    mesure('tuto_voix_telephone');
    const jeton = jetonTelephone.current;
    const synthese = window.speechSynthesis;
    const finir = () => {
      if (jetonTelephone.current !== jeton) return;
      arreterTelephone();
      setLecture('aucune');
      setPhrase(-1);
    };
    setLecture('telephone');
    setPhrase(0);
    versLaPage();
    // One sentence at a time: each one is lit as it starts, on every browser.
    const francaise = synthese.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr'));
    PHRASES_PLUS.forEach((texte, i) => {
      const enonce = new SpeechSynthesisUtterance(texte);
      enonce.lang = 'fr-FR';
      if (francaise) enonce.voice = francaise;
      enonce.onstart = () => {
        if (jetonTelephone.current === jeton) setPhrase(i);
      };
      enonce.onerror = finir;
      if (i === PHRASES_PLUS.length - 1) enonce.onend = finir;
      synthese.speak(enonce);
    });
  };

  const continuerVoix = () => {
    if (revelation) {
      aller(5);
      return;
    }
    silence();
    reveler();
  };

  const basculer = () => {
    debloque.current = true;
    const coupe = basculerSon();
    if (coupe) {
      arreterTelephone();
      setLecture('aucune');
      setPhrase(-1);
    } else if (replique) jouer(REPLIQUES[replique].voix);
  };

  // ---------- Layout ----------

  const padX = largeur < 360 ? 16 : 20;
  const compact = (etape >= 2 && etape <= 4) || (etape === 6 && hauteur < 700);
  const grande = Math.round(Math.min(largeur - padX * 2 - 40, hauteur * 0.42, 340));
  const moyenne = Math.round(Math.min(largeur * 0.5, hauteur * 0.25, 230));
  const petite = Math.round(Math.max(92, Math.min(124, hauteur * 0.15)));
  // On a short screen the gift step's line would slide under its two buttons:
  // she is smaller there (27 Nov 2026, 360 × 640).
  const taille = compact
    ? petite
    : etape === 6 || (etape === 5 && hauteur < 760)
      ? moyenne
      : grande;
  const etroit = largeur < 360;

  const textePage =
    etape === 2
      ? traduction === 'oui'
        ? demo.plus
        : demo.anglais
      : etape === 3 && version === 'standard'
        ? demo.standard
        : demo.plus;
  const badgePlus =
    (etape === 2 && traduction === 'oui') || (etape === 3 && version === 'plus') || etape === 4;

  const heros = (
    <div
      key={compact ? 'rangee' : 'colonne'}
      className={clsx('tuto-heros', compact ? 'tuto-heros--rangee' : 'tuto-heros--colonne')}
    >
      <Portrait pose={VISAGE[etape]} taille={taille} fondu={etape === 1 ? 1500 : 650} />
      <div className='tuto-heros__bulle'>
        <Bulle
          texte={REPLIQUES[replique ?? 'l1'].texte}
          visible={!!replique}
          pointe={compact ? 'gauche' : 'haut'}
          grand={!compact}
          etroit={etroit}
        />
      </div>
    </div>
  );

  const contenu = (
    <>
      {/* « Traduction standard » was cut at 360 px: the narrow toggle up to 380. */}
      {etape === 3 && <Bascule valeur={version} onChange={choisir} etroit={largeur < 380} />}

      {etape >= 2 && etape <= 4 && (
        <Page
          texte={textePage}
          anglais={textePage === demo.anglais}
          badge={badgePlus}
          surligne={etape === 4 && lecture !== 'aucune' ? phrase : -1}
          attente={traduction === 'en-cours' && etape === 2}
          etroit={etroit}
          court={hauteur < 700}
        />
      )}

      {etape === 6 && (
        <ul className='tuto-bienfaits'>
          {BIENFAITS.map(({ Icone, titre }) => (
            <li key={titre}>
              <span className='tuto-bienfaits__rond'>
                <Icone size={20} className='lel-icon' aria-hidden />
              </span>
              <span>{titre}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div
      ref={racine}
      className='tuto'
      role='dialog'
      aria-modal='true'
      aria-label='Découvrir Lis et Lead'
      tabIndex={-1}
      style={{ '--tuto-pad': `${padX}px` } as React.CSSProperties}
    >
      <style>{STYLES}</style>
      <div className='tuto__colonne'>
        <div className='tuto__haut'>
          <button
            type='button'
            className='tuto-pastille'
            aria-label={voix.coupe ? 'Remettre le son' : 'Couper le son'}
            onClick={basculer}
          >
            {voix.coupe ? (
              <PiSpeakerSlashDuotone size={20} className='lel-icon' aria-hidden />
            ) : (
              <PiSpeakerHighDuotone size={20} className='lel-icon' aria-hidden />
            )}
          </button>
          <button type='button' className='tuto-passer' onClick={passer}>
            Passer
          </button>
        </div>

        <div className='tuto__milieu'>
          {compact ? (
            <>
              {/* Compact: she stays in view while the page scrolls under her. */}
              <div className='tuto__tete'>{heros}</div>
              <div ref={defile} className='tuto__defile'>
                <div className='tuto__contenu'>{contenu}</div>
              </div>
            </>
          ) : (
            <div ref={defile} className='tuto__defile'>
              {/* Room above for her halo, so the scroll area never cuts it. */}
              <div className='tuto__centre' style={{ paddingTop: Math.round(taille * 0.2) }}>
                {heros}
                {contenu}
              </div>
            </div>
          )}
        </div>

        <div className='tuto__bas'>
          {etape === 1 && <Bouton label='Montrez-moi' Icone={PiArrowRightBold} onClick={montrer} />}

          {etape === 2 && (
            <div className='tuto__outils'>
              <Outil
                Icone={PiTranslateDuotone}
                label={traduction === 'non' ? 'Traduire' : 'Traduit'}
                actif={traduction !== 'non'}
                invite={traduction === 'non'}
                chargement={traduction === 'en-cours'}
                onClick={traduire}
              />
            </div>
          )}

          {etape === 3 && (
            <Bouton label='Continuer' Icone={PiArrowRightBold} onClick={() => aller(4)} />
          )}

          {etape === 4 && (
            <>
              <div className='tuto__outils tuto__outils--deux'>
                <Outil
                  Icone={lecture === 'plus' ? PiPauseFill : PiHeadphonesDuotone}
                  label={lecture === 'plus' ? 'Pause' : 'Écouter'}
                  actif={lecture === 'plus' || lecture === 'pause'}
                  invite={lecture === 'aucune' && !revelation}
                  onClick={ecouter}
                />
                {telephone && (
                  <Outil
                    Icone={lecture === 'telephone' ? PiStopFill : PiDeviceMobileDuotone}
                    label='Voix du téléphone'
                    actif={lecture === 'telephone'}
                    discret
                    onClick={voixTelephone}
                  />
                )}
              </div>
              <Bouton
                label='Continuer'
                Icone={PiArrowRightBold}
                genre={revelation ? 'or' : 'contour'}
                onClick={continuerVoix}
              />
            </>
          )}

          {etape === 5 &&
            (connecte ? (
              <Bouton label='Continuer' Icone={PiArrowRightBold} onClick={() => aller(6)} />
            ) : (
              <>
                <Bouton
                  label='Recevoir mon livre'
                  Icone={PiGiftDuotone}
                  onClick={() => {
                    mesure('tuto_cadeau');
                    fermer({ inscription: true });
                  }}
                />
                <button type='button' className='tuto-lien' onClick={() => aller(6)}>
                  Plus tard
                </button>
              </>
            ))}

          {etape === 6 && (
            <>
              <Bouton
                label='Découvrir Plus'
                onClick={() => {
                  mesure('tuto_plus');
                  fermer({ vers: connecte ? PAGE_PLUS : PAGE_PLUS_VISITEUR });
                }}
              />
              <Bouton
                label='Continuer gratuitement'
                genre='contour'
                onClick={() => {
                  mesure('tuto_gratuit');
                  fermer();
                }}
              />
            </>
          )}

          <Points etape={etape} />
        </div>
      </div>
    </div>
  );
}

// ---------- Pieces of the scene ----------

/**
 * The bookmark mascot, standing (transparent picture, no frame). It bobs and
 * sways a little, like a game guide; its poses cross-fade.
 */
function Portrait({ pose, taille, fondu }: { pose: Pose; taille: number; fondu: number }) {
  return (
    <div
      className='tuto-portrait'
      role='img'
      aria-label='Le marque-page de Lis et Lead'
      style={{ width: taille, height: taille, animationDuration: `${fondu}ms` }}
    >
      <span className='tuto-portrait__ombre' />
      <span className='tuto-portrait__corps'>
        {(Object.keys(POSES) as Pose[]).map((p) => (
          <img
            key={p}
            src={POSES[p]}
            alt=''
            draggable={false}
            className={clsx(
              'tuto-portrait__pose',
              p === pose && 'tuto-portrait__pose--active',
              // The pointing pose is drawn pointing left; mirrored, it points at the page.
              p === 'montre' && 'tuto-portrait__pose--miroir',
            )}
            style={{ transitionDuration: `${fondu}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

function Bulle({
  texte,
  visible,
  pointe,
  grand,
  etroit,
}: {
  texte: string;
  visible: boolean;
  pointe: 'haut' | 'gauche';
  grand: boolean;
  etroit: boolean;
}) {
  const corps = grand ? (etroit ? 17 : 18.5) : etroit ? 15 : 16;
  return (
    <div
      aria-live='polite'
      className={clsx(
        'tuto-bulle',
        `tuto-bulle--${pointe}`,
        grand && 'tuto-bulle--grande',
        visible && 'tuto-bulle--visible',
      )}
    >
      <p
        key={texte}
        className='tuto-bulle__texte'
        style={{
          fontSize: corps,
          lineHeight: `${Math.round(corps * 1.42)}px`,
          textAlign: grand ? 'center' : 'left',
        }}
      >
        {texte}
      </p>
      <span className='tuto-bulle__pointe' aria-hidden />
    </div>
  );
}

/** A page of a book, on light paper, in the reading font. */
function Page({
  texte,
  anglais,
  badge,
  surligne,
  attente,
  etroit,
  court,
}: {
  texte: string;
  anglais: boolean;
  badge: boolean;
  surligne: number;
  attente: boolean;
  etroit: boolean;
  court: boolean;
}) {
  // Short screens (under 700 px high): the whole page must fit above the buttons.
  const corps = court ? 14.5 : etroit ? 15.5 : 16.5;
  const interligne = court ? 1.45 : 1.55;
  const phrases = surligne >= 0 ? phrasesDe(texte) : null;
  return (
    <div className={clsx('tuto-page', etroit && 'tuto-page--etroite')}>
      <div className='tuto-page__entete'>
        {badge && (
          <span className='tuto-page__badge'>
            <PiSparkleFill size={11} aria-hidden />
            Plus
          </span>
        )}
      </div>
      <p
        key={texte}
        lang={anglais ? 'en' : 'fr'}
        className='tuto-page__texte'
        style={{
          fontSize: corps,
          lineHeight: `${Math.round(corps * interligne)}px`,
          opacity: attente ? 0.45 : 1,
        }}
      >
        {phrases
          ? phrases.map((ph, i) => (
              <Fragment key={i}>
                {i ? ' ' : ''}
                <span className={i === surligne ? 'tuto-page__lue' : undefined}>{ph}</span>
              </Fragment>
            ))
          : texte}
      </p>
    </div>
  );
}

/** « Traduction standard » / « Traduction Plus ». */
function Bascule({
  valeur,
  onChange,
  etroit,
}: {
  valeur: 'plus' | 'standard';
  onChange: (v: 'plus' | 'standard') => void;
  etroit: boolean;
}) {
  return (
    <div role='radiogroup' aria-label='Traduction' className='tuto-bascule'>
      {(['standard', 'plus'] as const).map((v) => {
        const actif = valeur === v;
        return (
          <button
            key={v}
            type='button'
            role='radio'
            aria-checked={actif}
            onClick={() => onChange(v)}
            className={clsx(
              'tuto-bascule__choix',
              actif && (v === 'plus' ? 'tuto-bascule__choix--or' : 'tuto-bascule__choix--creme'),
            )}
            style={{ fontSize: etroit ? 12.5 : 14, paddingInline: etroit ? 4 : 8 }}
          >
            {v === 'plus' ? 'Traduction Plus' : 'Traduction standard'}
          </button>
        );
      })}
    </div>
  );
}

/** A round tool like the reader's toolbar (« Traduire », « Écouter »). */
function Outil({
  Icone,
  label,
  onClick,
  actif,
  invite,
  chargement,
  discret,
}: {
  Icone: IconType;
  label: string;
  onClick: () => void;
  actif?: boolean;
  invite?: boolean;
  chargement?: boolean;
  discret?: boolean;
}) {
  return (
    <button type='button' className='tuto-outil' onClick={onClick}>
      <span className='tuto-outil__zone'>
        {invite && <span className='tuto-onde' aria-hidden />}
        <span
          className={clsx(
            'tuto-outil__rond',
            actif && 'tuto-outil__rond--actif',
            discret && 'tuto-outil__rond--discret',
          )}
        >
          {chargement ? (
            <span className='tuto-roue' aria-hidden />
          ) : (
            <Icone size={discret ? 21 : 25} className='lel-icon' aria-hidden />
          )}
        </span>
      </span>
      <span className='tuto-outil__label'>{label}</span>
    </button>
  );
}

function Bouton({
  label,
  onClick,
  Icone,
  genre = 'or',
}: {
  label: string;
  onClick: () => void;
  Icone?: IconType;
  genre?: 'or' | 'contour';
}) {
  return (
    <button type='button' className={`tuto-bouton tuto-bouton--${genre}`} onClick={onClick}>
      {Icone && <Icone size={20} className='lel-icon' aria-hidden />}
      <span>{label}</span>
    </button>
  );
}

function Points({ etape }: { etape: Etape }) {
  return (
    <div className='tuto-points' role='img' aria-label={`Étape ${etape} sur 6`}>
      {([1, 2, 3, 4, 5, 6] as const).map((i) => (
        <span
          key={i}
          className={clsx(
            'tuto-points__point',
            i === etape && 'tuto-points__point--actuel',
            i < etape && 'tuto-points__point--passe',
          )}
        />
      ))}
    </div>
  );
}

// Her scene: midnight blue and gold, whatever the reading theme.
const STYLES = `
.tuto {
  position: fixed; inset: 0; z-index: 900;
  display: flex; justify-content: center;
  background-color: #0A0F1A;
  background-image:
    radial-gradient(ellipse 130% 60% at 50% 0%, rgba(242,193,78,0.10), rgba(242,193,78,0) 72%),
    radial-gradient(ellipse 100% 55% at 0% 100%, rgba(71,103,179,0.22), rgba(71,103,179,0) 72%),
    radial-gradient(ellipse 85% 50% at 100% 72%, rgba(34,59,120,0.28), rgba(34,59,120,0) 72%),
    linear-gradient(180deg, #121A2E 0%, #0A0F1A 52%, #070A12 100%);
  color: #F4EBDD;
  font-family: 'DM Sans Variable', ui-sans-serif, system-ui, sans-serif;
  -webkit-tap-highlight-color: transparent;
  outline: none;
  animation: tuto-fondu .35s ease both;
}
:where(.tuto) button { font-family: inherit; color: inherit; cursor: pointer; }
.tuto button:focus-visible { outline: 3px solid #F2C14E; outline-offset: 3px; }
.tuto__colonne {
  position: relative; width: 100%; max-width: 30rem; height: 100%;
  display: flex; flex-direction: column;
}
.tuto__haut {
  display: flex; align-items: center; justify-content: space-between;
  padding: calc(env(safe-area-inset-top, 0px) + 6px) calc(var(--tuto-pad) - 4px) 4px;
}
.tuto__milieu { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tuto__tete { padding: 12px var(--tuto-pad) 4px; }
.tuto__defile {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: none;
}
.tuto__defile::-webkit-scrollbar { display: none; }
.tuto__contenu {
  display: flex; flex-direction: column; gap: 16px;
  padding: 12px var(--tuto-pad) 18px;
}
.tuto__centre {
  box-sizing: border-box; min-height: 100%;
  display: flex; flex-direction: column; justify-content: center; gap: 24px;
  padding: 0 var(--tuto-pad) 18px;
}
.tuto__bas {
  display: flex; flex-direction: column; gap: 12px;
  padding: 8px var(--tuto-pad) calc(env(safe-area-inset-bottom, 0px) + 14px);
}
.tuto__outils { display: flex; justify-content: center; }
.tuto__outils--deux { gap: 22px; }

.tuto-pastille {
  width: 40px; height: 40px; border-radius: 999px; border: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,248,235,0.08);
}
.tuto-passer {
  height: 38px; padding: 0 16px; border-radius: 999px; border: 0;
  background: rgba(255,248,235,0.08); font-size: 15px; font-weight: 500;
}
.tuto-pastille:active, .tuto-passer:active { background: rgba(255,248,235,0.16); }
@media (hover: hover) {
  .tuto-pastille:hover, .tuto-passer:hover { background: rgba(255,248,235,0.14); }
}

/* Her and her bubble */
.tuto-heros { animation: tuto-fondu .45s ease both; }
.tuto-heros--colonne { display: flex; flex-direction: column; align-items: center; gap: 22px; }
.tuto-heros--colonne .tuto-heros__bulle { align-self: stretch; }
.tuto-heros--rangee { display: flex; align-items: center; gap: 14px; }
.tuto-heros--rangee .tuto-heros__bulle { flex: 1; min-width: 0; }

.tuto-portrait {
  position: relative; flex: none;
  animation: tuto-fondu 1.5s ease both;
  transition: width .48s cubic-bezier(.2,.9,.25,1), height .48s cubic-bezier(.2,.9,.25,1);
}
.tuto-portrait__ombre {
  position: absolute; left: 28%; right: 28%; bottom: 3%; height: 7%; border-radius: 9999px;
  background: radial-gradient(closest-side, rgba(242,193,78,0.30), rgba(242,193,78,0));
  animation: tuto-ombre 1.6s ease-in-out infinite alternate;
}
.tuto-portrait__corps {
  position: absolute; inset: 0;
  animation: tuto-souffle 1.6s ease-in-out infinite alternate;
}
.tuto-portrait__pose {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
  opacity: 0; transition-property: opacity; transition-timing-function: ease-in-out;
  pointer-events: none; user-select: none; -webkit-user-select: none;
}
.tuto-portrait__pose--active { opacity: 1; }
.tuto-portrait__pose--miroir { transform: scaleX(-1); }

.tuto-bulle {
  position: relative; border-radius: 20px; padding: 12px 15px;
  background: #111726; border: 1px solid rgba(242,193,78,0.30);
  opacity: 0; transform: translateY(10px);
  transition: opacity .52s cubic-bezier(.33,1,.68,1), transform .52s cubic-bezier(.33,1,.68,1);
}
.tuto-bulle--grande { padding: 16px 20px; }
.tuto-bulle--visible { opacity: 1; transform: none; }
.tuto-bulle__texte {
  margin: 0; color: #F4EBDD;
  font-family: 'Source Serif 4', ui-serif, Georgia, 'Times New Roman', serif;
  animation: tuto-fondu .42s ease both;
}
.tuto-bulle__pointe {
  position: absolute; width: 14px; height: 14px; background: #111726;
  border: 0 solid rgba(242,193,78,0.30); transform: rotate(45deg);
}
.tuto-bulle--haut .tuto-bulle__pointe {
  top: -8px; left: 50%; margin-left: -7px; border-top-width: 1px; border-left-width: 1px;
}
.tuto-bulle--gauche .tuto-bulle__pointe {
  left: -8px; top: 50%; margin-top: -7px; border-left-width: 1px; border-bottom-width: 1px;
}

/* The page of the book */
.tuto-page {
  background: #FBF8F1; border-radius: 16px; padding: 12px 22px 22px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.55);
}
.tuto-page--etroite { padding: 12px 18px 18px; }
.tuto-page__entete { height: 22px; margin-bottom: 4px; display: flex; justify-content: flex-end; align-items: center; }
.tuto-page__badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px;
  background: #F2C14E; color: #241A06; font-size: 12px; line-height: 16px; font-weight: 700;
  animation: tuto-fondu .35s ease both;
}
.tuto-page__texte {
  margin: 0; color: #1C222F;
  font-family: 'Source Serif 4', ui-serif, Georgia, 'Times New Roman', serif;
  transition: opacity .3s ease;
  animation: tuto-fondu .48s ease both;
}
.tuto-page__lue { background: rgba(242,193,78,0.45); border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }

/* Standard / Plus */
.tuto-bascule {
  display: flex; padding: 4px; border-radius: 999px;
  background: rgba(255,248,235,0.08); border: 1px solid rgba(255,248,235,0.12);
  animation: tuto-monte .4s ease both;
}
.tuto-bascule__choix {
  flex: 1; min-width: 0; min-height: 42px; border-radius: 999px; border: 0; background: transparent;
  font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background-color .2s ease, color .2s ease;
}
.tuto-bascule__choix--or { background: #F2C14E; color: #241A06; }
.tuto-bascule__choix--creme { background: #F4EBDD; color: #241A06; }

/* Round tools */
.tuto-outil {
  width: 92px; display: flex; flex-direction: column; align-items: center; gap: 6px;
  border: 0; background: none; padding: 0;
}
.tuto-outil:active { opacity: .8; }
.tuto-outil__zone { position: relative; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; }
.tuto-outil__rond {
  position: relative; width: 56px; height: 56px; border-radius: 28px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,248,235,0.10); border: 1px solid rgba(255,248,235,0.18); color: #F4EBDD;
}
.tuto-outil__rond--discret { width: 48px; height: 48px; }
.tuto-outil__rond--actif { background: #F2C14E; border-color: #F2C14E; color: #241A06; }
.tuto-outil__label { font-size: 12.5px; line-height: 16px; font-weight: 500; text-align: center; }
.tuto-onde {
  position: absolute; inset: 0; border-radius: 28px; border: 2px solid #F2C14E;
  animation: tuto-onde 1.5s cubic-bezier(.5,1,.89,1) infinite;
}
.tuto-roue {
  width: 22px; height: 22px; border-radius: 999px;
  border: 2.5px solid currentColor; border-top-color: transparent;
  animation: tuto-tourne .8s linear infinite;
}

/* Buttons */
.tuto-bouton {
  min-height: 52px; border-radius: 999px; padding: 14px 22px;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  font-size: 16px; font-weight: 700; line-height: 1.2;
  transition: transform .15s ease, opacity .15s ease, background-color .15s ease;
}
.tuto-bouton span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tuto-bouton:active { transform: scale(.98); }
.tuto-bouton--or { background: #F2C14E; color: #241A06; border: 0; }
.tuto-bouton--or:active { opacity: .88; }
.tuto-bouton--contour { background: transparent; color: #F4EBDD; border: 1.5px solid rgba(244,235,221,0.55); }
.tuto-bouton--contour:active { background: rgba(255,248,235,0.08); }
.tuto-lien {
  align-self: center; padding: 8px 18px; border: 0; background: none;
  font-size: 15px; font-weight: 500; color: #A9B0C0;
}
.tuto-lien:active { opacity: .6; }
/* The gold layer of the icons would vanish on gold. */
.tuto-bouton--or .lel-icon path[opacity='0.2'],
.tuto-outil__rond--actif .lel-icon path[opacity='0.2'] { fill: #241A06 !important; opacity: .25; }

/* The benefits of Plus */
.tuto-bienfaits {
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px;
  animation: tuto-monte .45s .15s ease both;
}
.tuto-bienfaits li { display: flex; align-items: center; gap: 14px; font-size: 15.5px; line-height: 21px; font-weight: 700; }
.tuto-bienfaits__rond {
  flex: none; width: 40px; height: 40px; border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(242,193,78,0.12); border: 1px solid rgba(242,193,78,0.30); color: #F2C14E;
}

/* Where we are */
.tuto-points { display: flex; justify-content: center; align-items: center; gap: 7px; padding-top: 2px; }
.tuto-points__point {
  width: 6px; height: 6px; border-radius: 3px; background: rgba(244,235,221,0.22);
  transition: width .3s ease, background-color .3s ease;
}
.tuto-points__point--passe { background: rgba(242,193,78,0.45); }
.tuto-points__point--actuel { width: 20px; background: #F2C14E; }

@keyframes tuto-fondu { from { opacity: 0; } to { opacity: 1; } }
@keyframes tuto-monte { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes tuto-souffle {
  from { transform: translateY(0) rotate(-1.5deg); }
  to { transform: translateY(-3%) rotate(1.5deg); }
}
@keyframes tuto-ombre {
  from { opacity: .55; transform: scaleX(1); }
  to { opacity: .35; transform: scaleX(.88); }
}
@keyframes tuto-onde {
  from { opacity: .85; transform: scale(1); }
  to { opacity: 0; transform: scale(1.5); }
}
@keyframes tuto-tourne { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .tuto-portrait__corps, .tuto-portrait__ombre, .tuto-onde { animation: none; }
}
html[data-eink='true'] .tuto { background-image: none; }
html[data-eink='true'] .tuto * { animation: none !important; transition: none !important; box-shadow: none !important; }
`;
