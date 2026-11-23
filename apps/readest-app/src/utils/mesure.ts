import { isWebAppPlatform } from '@/services/environment';

// Sends one audience event to /api/stats/evenement (see that route for what is
// kept). Web only; never blocks the page and never throws.
export const mesurer = (evenement: string) => {
  if (typeof window === 'undefined' || !isWebAppPlatform()) return;
  try {
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
