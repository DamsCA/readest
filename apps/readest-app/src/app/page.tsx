'use client';

import { useEffect, useState } from 'react';
import { isWebAppPlatform } from '@/services/environment';
import LibraryPage from './library/page';
import { BIENVENUE_VUE } from './bienvenue/LienBibliotheque';

// On the web, a first-time visitor (no account yet) arriving on the shared link
// lands in the app itself, on the sign-up form, not on a sales page. The
// owner's call (23 Nov 2026): « au lieu d'atterrir direct sur l'application,
// t'atterris sur une espèce de page de vente ». After signing up they reach the
// library, where the gift book waits. Readers who are signed in, or who chose to
// open the library from the welcome page, and the installed apps go straight to
// the library as before. The welcome page stays at /bienvenue.
const INSCRIPTION = '/auth?inscription=1';

const doitSInscrire = () => {
  if (!isWebAppPlatform()) return false;
  try {
    return !localStorage.getItem('token') && !localStorage.getItem(BIENVENUE_VUE);
  } catch {
    return false;
  }
};

export default function HomePage() {
  const [pret, setPret] = useState(!isWebAppPlatform());

  useEffect(() => {
    if (pret) return;
    if (doitSInscrire()) {
      window.location.replace(INSCRIPTION);
    } else {
      setPret(true);
    }
  }, [pret]);

  return pret ? <LibraryPage /> : null;
}
