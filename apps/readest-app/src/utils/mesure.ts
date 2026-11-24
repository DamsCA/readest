import { isWebAppPlatform } from '@/services/environment';

// Set by /stats on the owner's devices: they are never counted.
export const CLE_PROPRIETAIRE = 'lel-moi';

// The owner's own pages: the dashboard, and the sign-in that leads to it.
const pageDuProprietaire = () => {
  const { pathname, search } = window.location;
  return (
    pathname.startsWith('/stats') ||
    (pathname.startsWith('/auth') && /redirect=(%2F|\/)stats/i.test(search))
  );
};

// Sends one audience event to /api/stats/evenement (see that route for what is
// kept). Web only; never blocks the page and never throws.
export const mesurer = (evenement: string) => {
  if (typeof window === 'undefined' || !isWebAppPlatform()) return;
  try {
    if (pageDuProprietaire()) return;
    try {
      if (localStorage.getItem(CLE_PROPRIETAIRE) === '1') return;
    } catch {
      // No storage: count the visit.
    }
    let connecte = false;
    try {
      connecte = !!localStorage.getItem('token');
    } catch {
      connecte = false;
    }
    const corps = JSON.stringify({
      e: evenement,
      p: window.location.pathname,
      r: document.referrer,
      c: connecte,
    });
    if (navigator.sendBeacon?.('/api/stats/evenement', corps)) return;
    void fetch('/api/stats/evenement', { method: 'POST', body: corps, keepalive: true }).catch(
      () => undefined,
    );
  } catch {
    // Audience counting must never get in the reader's way.
  }
};
