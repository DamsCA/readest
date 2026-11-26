import { NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { COOKIE_PROPRIETAIRE, empreinteReseau, empreinteVisiteur } from '@/utils/empreinte';

// Audience of the web reader (owner's ask, 23 Nov 2026: « c'est pas normal de
// pas savoir s'il y a des visiteurs »). Each page shown, and each step of the
// sign-up invitation, sends one small event here (utils/mesure.ts). Nothing is
// stored on the device and no IP is kept: a visitor is a hash of the day, the
// IP, the browser and a server secret, which counts unique visitors per day
// without following anyone from one day to the next (utils/empreinte.ts).
// The owner is not counted: devices that opened /stats carry a cookie and are
// dropped here, and the network the owner opened /stats from is left out of
// that day's figures by stats_visites.
// Table public.visites (docker/volumes/db/ouiread/ouiread-visites.sql).

export const dynamic = 'force-dynamic';

const EVENEMENTS = new Set([
  'vue',
  'invitation_vue',
  'invitation_google',
  'invitation_apple',
  'invitation_email',
  'invitation_fermee',
  'invitation_navigateur',
  // The TikTok bio page (legenieendormi.web.app, ktaffilliate/bio-genie-endormi).
  'bio_vue',
  // Our French guide to Kevin's book, opened at legenieendormi.web.app/guide.
  'bio_guide',
  'bio_kevin',
  'bio_liseuse',
  'bio_cadeau',
  'bio_telegram',
  'bio_arrivee',
  // The phone app (26 Nov 2026, the owner's « active maintenant »): its welcome
  // tour with the bookmark mascot, the reminders in the reader, and sign-ups.
  'tuto_vu',
  'tuto_traduire',
  'tuto_difference',
  'tuto_ecouter',
  'tuto_voix_telephone',
  'tuto_cadeau',
  'tuto_plus',
  'tuto_gratuit',
  'tuto_passe_1',
  'tuto_passe_2',
  'tuto_passe_3',
  'tuto_passe_4',
  'tuto_passe_5',
  'tuto_passe_6',
  'rappel_traduction',
  'rappel_voix',
  'rappel_chapitre',
  'rappel_plus_clic',
  'app_inscription_email',
]);

// Link previews and crawlers are not visitors. « lel-verif » marks our own
// checks of the live site.
const ROBOTS = /bot|crawl|spider|preview|facebookexternalhit|bytespider|headless|lel-verif/i;

const texte = (value: unknown, max: number) =>
  typeof value === 'string' && value ? value.slice(0, max) : null;

const domaine = (referrer: string | null) => {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host === 'lisetlead.com' ? null : host;
  } catch {
    return null;
  }
};

// The kind of phone and the app whose browser opened the page, read from the
// user agent: « iPhone · TikTok », « Android », « ordinateur »…
const appareil = (navigateur: string) => {
  // The phone app itself (no browser): React Native on Android sends okhttp,
  // the iPhone app « LisetLead/<build> CFNetwork… ». Until the app is public,
  // these are the store testers, left out by stats_visites (stats_reglages).
  if (/okhttp/i.test(navigateur)) return 'Android · appli';
  if (
    /LisetLead\//i.test(navigateur) ||
    (/CFNetwork/i.test(navigateur) && !/Mozilla/i.test(navigateur))
  ) {
    return 'iPhone · appli';
  }
  const sorte = /iPhone|iPad|iPod/i.test(navigateur)
    ? 'iPhone'
    : /Android/i.test(navigateur)
      ? 'Android'
      : 'ordinateur';
  const appli = /musical_ly|BytedanceWebview|TikTok|trill_/i.test(navigateur)
    ? 'TikTok'
    : /Instagram/i.test(navigateur)
      ? 'Instagram'
      : /FBAN|FBAV|FB_IAB/i.test(navigateur)
        ? 'Facebook'
        : null;
  return appli ? `${sorte} · ${appli}` : sorte;
};

const rien = () => new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  let corps: { e?: unknown; p?: unknown; r?: unknown; c?: unknown } | null = null;
  try {
    corps = JSON.parse(await req.text());
  } catch {
    return rien();
  }
  const evenement = texte(corps?.e, 40);
  if (!evenement || !EVENEMENTS.has(evenement)) return rien();

  const navigateur = req.headers.get('user-agent') || '';
  if (!navigateur || ROBOTS.test(navigateur)) return rien();
  // The owner's own devices (marked when they open /stats).
  if (req.cookies.get(COOKIE_PROPRIETAIRE)?.value === '1') return rien();

  const visiteur = await empreinteVisiteur(req);
  const reseau = await empreinteReseau(req);

  const chemin = texte(corps?.p, 200)?.split('?')[0] ?? null;
  const { error } = await createSupabaseAdminClient()
    .from('visites')
    .insert({
      evenement,
      chemin,
      provenance: domaine(texte(corps?.r, 500)),
      pays: req.headers.get('cf-ipcountry'),
      visiteur,
      appareil: appareil(navigateur),
      connecte: corps?.c === true,
      reseau,
    });
  if (error) console.error('visites:', error.message);
  return rien();
}
