import { NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';

// Audience of the web reader (owner's ask, 23 Nov 2026: « c'est pas normal de
// pas savoir s'il y a des visiteurs »). Each page shown, and each step of the
// sign-up invitation, sends one small event here (utils/mesure.ts). Nothing is
// stored on the device and no IP is kept: a visitor is a hash of the day, the
// IP, the browser and a server secret, which counts unique visitors per day
// without following anyone from one day to the next.
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
  'bio_kevin',
  'bio_liseuse',
  'bio_cadeau',
  'bio_telegram',
  'bio_arrivee',
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

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '';
  const jour = new Date().toISOString().slice(0, 10);
  const secret = process.env['SUPABASE_ADMIN_KEY'] || '';
  const visiteur = (await sha256Hex(`${jour}|${ip}|${navigateur}|${secret}`)).slice(0, 16);

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
    });
  if (error) console.error('visites:', error.message);
  return rien();
}
