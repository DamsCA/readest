'use client';

import { useEffect, useState } from 'react';
import { isWebAppPlatform } from '@/services/environment';
import LibraryPage from './library/page';
import { BIENVENUE_VUE } from './bienvenue/LienBibliotheque';

// On the web, a first-time visitor (no account, never seen the welcome page)
// arriving on the shared link is shown what Lis et Lead does before an empty
// library. Readers who are signed in, or who chose to open the library, and
// the installed apps go straight to the library as before.
const doitVoirBienvenue = () => {
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
    if (doitVoirBienvenue()) {
      window.location.replace('/bienvenue');
    } else {
      setPret(true);
    }
  }, [pret]);

  return pret ? <LibraryPage /> : null;
}
