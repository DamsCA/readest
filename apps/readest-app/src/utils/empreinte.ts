// Audience fingerprints, shared by /api/stats/evenement (which writes them)
// and /api/stats/resume (which marks the owner). No IP is ever stored: only
// a hash of it with the day and a server secret, which changes every day.

// The owner's devices carry this cookie once they have opened /stats; the
// audience route then drops their events (owner's ask, 24 Nov 2026: « il faut
// arrêter de me compter moi »).
export const COOKIE_PROPRIETAIRE = 'lel_moi';

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export const ipDe = (req: Request) =>
  req.headers.get('cf-connecting-ip') ||
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  '';

// The network an address belongs to: the address itself for IPv4, the /64
// prefix for IPv6 (a home connection gives each device its own address
// inside one /64).
export const reseauDe = (ip: string) => {
  if (!ip.includes(':')) return ip;
  const [tete = '', queue] = ip.toLowerCase().split('::');
  const debut = tete ? tete.split(':') : [];
  const fin = queue ? queue.split(':') : [];
  const groupes =
    queue === undefined
      ? debut
      : [...debut, ...Array(Math.max(0, 8 - debut.length - fin.length)).fill('0'), ...fin];
  return `${groupes
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
};

const jour = () => new Date().toISOString().slice(0, 10);
const secret = () => process.env['SUPABASE_ADMIN_KEY'] || '';

// One browser on one network for one day: counts unique visitors per day.
export const empreinteVisiteur = async (req: Request) =>
  (
    await sha256Hex(`${jour()}|${ipDe(req)}|${req.headers.get('user-agent') || ''}|${secret()}`)
  ).slice(0, 16);

// One network for one day, whatever the device: when the owner opens /stats,
// the network the owner is on is left out of the day's figures, the owner's
// phone included.
export const empreinteReseau = async (req: Request) =>
  (await sha256Hex(`reseau|${jour()}|${reseauDe(ipDe(req))}|${secret()}`)).slice(0, 16);
