'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FcGoogle } from 'react-icons/fc';
import { FaApple } from 'react-icons/fa';
import { useAuth } from '@/context/AuthContext';
import { isWebAppPlatform } from '@/services/environment';
import { AUTH_OAUTH_PROVIDERS, GOOGLE_WEB_CLIENT_ID } from '@/services/features';
import { startGoogleSignIn } from '@/app/auth/utils/googleWeb';
import { startAppleSignIn } from '@/app/auth/utils/appleWeb';
import { mesurer } from '@/utils/mesure';

// The owner's ask (23 Nov 2026): a visitor lands in the app itself, then a
// window invites them to sign up with the gift book as the reason; they may
// close it and look around without an account. Web only, never for a signed-in
// reader. Closed, it stays closed until the next visit.

const COVER = '/images/ca-marche-couverture.webp';
// 25/11 : the second welcome book, our French guide (src/libs/ouiread/welcomeGift.ts).
const COVER_GUIDE = '/images/guide-formule-couverture.webp';
const FERMEE = 'lel-invitation-fermee';
const DELAI_MS = 1500;
const INSCRIPTION_EMAIL = '/auth?inscription=1';

// TikTok, Instagram and Facebook open links in their own browser, where the
// visitor is not signed in to Google: Google then asks for the address and the
// password, and many give up (a TikTok visitor clicked Google on 24 Nov and never
// came back). In the phone's own browser the same visitor taps their account.
const appliHote = () => {
  const ua = navigator.userAgent;
  if (/musical_ly|BytedanceWebview|TikTok|trill_/i.test(ua)) return 'TikTok';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  return null;
};

const lienNavigateur = () => {
  const ua = navigator.userAgent;
  const page = 'lisetlead.com/?depuis=appli';
  if (/Android/i.test(ua)) {
    const secours = encodeURIComponent(`https://${page}`);
    return `intent://${page}#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${secours};end`;
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return `x-safari-https://${page}`;
  return `https://${page}`;
};

// Sign in with Apple (owner's ask, 24 Nov 2026: not everyone has a Google
// account, and iPhone readers sign in with Face ID in Safari). Shown once Apple
// is on in NEXT_PUBLIC_AUTH_PROVIDERS; first on an iPhone.
const APPLE = AUTH_OAUTH_PROVIDERS.includes('apple');

const doitInviter = () => {
  if (!isWebAppPlatform()) return false;
  try {
    return !localStorage.getItem('token') && !sessionStorage.getItem(FERMEE);
  } catch {
    return false;
  }
};

export default function InvitationInscription() {
  const { user } = useAuth();
  const [ouverte, setOuverte] = useState(false);
  const [appli, setAppli] = useState<string | null>(null);
  const [iphone, setIphone] = useState(false);

  useEffect(() => {
    if (user) {
      setOuverte(false);
      return undefined;
    }
    const t = setTimeout(() => {
      if (doitInviter()) {
        setAppli(appliHote());
        setIphone(/iPhone|iPad|iPod/i.test(navigator.userAgent));
        setOuverte(true);
        mesurer('invitation_vue');
      }
    }, DELAI_MS);
    return () => clearTimeout(t);
  }, [user]);

  if (!ouverte) return null;

  const fermer = () => {
    try {
      sessionStorage.setItem(FERMEE, '1');
    } catch {
      // Private browsing: it simply shows again next time.
    }
    mesurer('invitation_fermee');
    setOuverte(false);
  };

  const avecApple = () => {
    mesurer('invitation_apple');
    void startAppleSignIn('/library');
  };

  const avecGoogle = () => {
    mesurer('invitation_google');
    if (GOOGLE_WEB_CLIENT_ID) {
      void startGoogleSignIn('/library');
    } else {
      window.location.assign(INSCRIPTION_EMAIL);
    }
  };

  return createPortal(
    <div className='lel-invite' role='dialog' aria-modal='true' aria-labelledby='lel-invite-titre'>
      <style>{STYLES}</style>
      <button type='button' className='lel-invite__fond' aria-label='Fermer' onClick={fermer} />
      <div className='lel-invite__carte'>
        <button type='button' className='lel-invite__croix' aria-label='Fermer' onClick={fermer}>
          ×
        </button>
        <div className='lel-invite__livres'>
          <img className='lel-invite__livre' src={COVER} alt='« Ça marche »' draggable={false} />
          <img
            className='lel-invite__livre lel-invite__livre--guide'
            src={COVER_GUIDE}
            alt='« La formule de Kevin Trudeau »'
            draggable={false}
          />
        </div>
        <p className='lel-invite__sur'>Cadeau de bienvenue</p>
        <h2 id='lel-invite-titre' className='lel-invite__titre'>
          Deux livres vous attendent
        </h2>
        <p className='lel-invite__texte'>
          « Ça marche », le célèbre petit livre rouge de 1926, et « La formule de Kevin Trudeau », 6
          ingrédients sur 45. En français. Créez votre compte gratuit : ils arrivent aussitôt dans
          votre bibliothèque.
        </p>
        {appli && (
          <div className='lel-invite__appli'>
            <p>
              Vous êtes dans {appli}. Ouvrez la page dans votre navigateur : l’inscription s’y fait
              en un geste.
            </p>
            <a
              className='lel-invite__navigateur'
              href={lienNavigateur()}
              onClick={() => mesurer('invitation_navigateur')}
            >
              Ouvrir dans mon navigateur
            </a>
            <p className='lel-invite__secours'>
              Rien ne s’ouvre ? Touchez ⋯ en haut de l’écran, puis « Ouvrir dans le navigateur ».
            </p>
          </div>
        )}
        {APPLE && iphone && (
          <button
            type='button'
            className='lel-invite__apple lel-invite__apple--haut'
            onClick={avecApple}
          >
            <FaApple size={20} aria-hidden='true' />
            Recevoir mes livres avec Apple
          </button>
        )}
        <button type='button' className='lel-invite__google' onClick={avecGoogle}>
          <FcGoogle size={22} aria-hidden='true' />
          Recevoir mes livres avec Google
        </button>
        {APPLE && !iphone && (
          <button type='button' className='lel-invite__apple' onClick={avecApple}>
            <FaApple size={20} aria-hidden='true' />
            Recevoir mes livres avec Apple
          </button>
        )}
        <a
          className='lel-invite__email'
          href={INSCRIPTION_EMAIL}
          onClick={() => mesurer('invitation_email')}
        >
          Avec mon adresse e-mail
        </a>
        <p className='lel-invite__note'>Gratuit, sans carte bancaire</p>
        <button type='button' className='lel-invite__plus-tard' onClick={fermer}>
          Plus tard, je visite d’abord
        </button>
      </div>
    </div>,
    document.body,
  );
}

const STYLES = `
.lel-invite {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: flex-end; justify-content: center;
}
@media (min-width: 640px) { .lel-invite { align-items: center; } }
.lel-invite__fond {
  position: absolute; inset: 0; border: 0; cursor: default;
  background: rgba(6, 10, 20, 0.5);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  animation: lel-invite-fondu 0.3s ease both;
}
.lel-invite__carte {
  position: relative; width: 100%; max-width: 26rem;
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 1.75rem 1.5rem calc(1.25rem + env(safe-area-inset-bottom));
  border-radius: 2rem 2rem 0 0;
  background: linear-gradient(180deg, #223b78 0%, #101728 58%);
  color: #f3ecdd;
  box-shadow: 0 -18px 48px -16px rgba(3, 6, 13, 0.5);
  animation: lel-invite-monte 0.45s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
@media (min-width: 640px) { .lel-invite__carte { border-radius: 1.75rem; padding-bottom: 1.5rem; } }
.lel-invite__croix {
  position: absolute; top: 0.75rem; right: 0.9rem;
  width: 2.25rem; height: 2.25rem; border-radius: 999px;
  font-size: 1.6rem; line-height: 1; color: #f3ecdd; opacity: 0.7;
  background: rgba(243, 236, 221, 0.08);
}
.lel-invite__livres { display: flex; justify-content: center; align-items: flex-end; }
.lel-invite__livres .lel-invite__livre { width: 6.4rem; }
.lel-invite__livres .lel-invite__livre--guide {
  margin-left: -1.4rem; position: relative;
  animation-name: lel-invite-livre-guide; animation-delay: 0.3s;
}
.lel-invite__livre {
  width: 7.5rem; height: auto; border-radius: 0.5rem;
  box-shadow: 0 18px 36px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(232, 192, 106, 0.35);
  margin-bottom: 1.1rem;
  animation: lel-invite-livre 0.7s 0.15s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
.lel-invite__sur {
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: #e8c06a;
}
.lel-invite__titre {
  margin-top: 0.35rem;
  font-family: 'Bricolage Grotesque Variable', 'DM Sans Variable', ui-sans-serif, sans-serif;
  font-size: 1.5rem; font-weight: 800; line-height: 1.15; letter-spacing: -0.01em;
  color: #f3d48d;
}
.lel-invite__texte {
  margin-top: 0.6rem; font-size: 0.95rem; line-height: 1.45; opacity: 0.9;
}
.lel-invite__google {
  margin-top: 1.25rem; width: 100%; min-height: 3.25rem;
  display: flex; align-items: center; justify-content: center; gap: 0.6rem;
  border-radius: 999px; background: #e8c06a; color: #101728;
  font-size: 1rem; font-weight: 700;
  box-shadow: 0 10px 24px -10px rgba(232, 192, 106, 0.9);
}
.lel-invite__google:active { transform: scale(0.98); }
.lel-invite__google svg {
  background: #fff; border-radius: 999px; padding: 2px; width: 26px; height: 26px;
}
.lel-invite__appli {
  margin-top: 1.1rem; width: 100%; padding: 0.9rem 0.9rem 0.8rem; border-radius: 1.1rem;
  background: rgba(232, 192, 106, 0.12); border: 1px solid rgba(232, 192, 106, 0.45);
  font-size: 0.88rem; line-height: 1.4;
}
.lel-invite__navigateur {
  margin-top: 0.7rem; display: flex; align-items: center; justify-content: center;
  min-height: 3rem; border-radius: 999px; background: #f3ecdd; color: #101728;
  font-weight: 700; font-size: 0.98rem; text-decoration: none;
}
.lel-invite__secours { margin-top: 0.55rem; font-size: 0.76rem; opacity: 0.7; }
.lel-invite__apple {
  margin-top: 0.7rem; width: 100%; min-height: 3.25rem;
  display: flex; align-items: center; justify-content: center; gap: 0.55rem;
  border-radius: 999px; background: #000; color: #fff; font-size: 1rem; font-weight: 700;
  border: 1px solid rgba(243, 236, 221, 0.25);
}
.lel-invite__apple--haut { margin-top: 1.25rem; }
.lel-invite__apple:active { transform: scale(0.98); }
.lel-invite__email {
  margin-top: 0.85rem; font-size: 0.92rem; font-weight: 600;
  color: #f3ecdd; text-decoration: underline; text-underline-offset: 3px;
}
.lel-invite__note { margin-top: 0.75rem; font-size: 0.78rem; opacity: 0.65; }
.lel-invite__plus-tard {
  margin-top: 0.4rem; padding: 0.5rem 1rem; font-size: 0.85rem; color: #f3ecdd; opacity: 0.75;
}
@keyframes lel-invite-fondu { from { opacity: 0; } to { opacity: 1; } }
@keyframes lel-invite-monte { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes lel-invite-livre { from { transform: translateY(16px) rotate(-6deg) scale(0.9); opacity: 0; } to { transform: rotate(-3deg); opacity: 1; } }
@keyframes lel-invite-livre-guide { from { transform: translateY(16px) rotate(8deg) scale(0.9); opacity: 0; } to { transform: translateY(0.3rem) rotate(5deg); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .lel-invite__fond, .lel-invite__carte, .lel-invite__livre { animation: none; }
}
`;
