/**
 * What this edition of the app offers.
 *
 * Accounts, cloud sync and cloud storage run on Ouiread's own backend
 * (Supabase for accounts and data, Cloudflare R2 for book files). They are
 * switched on per build with NEXT_PUBLIC_CLOUD_ENABLED=true: the web deploy
 * sets it, and the Google Play build leaves it off until the app ships with
 * accounts. Readest's own services stay off in every build: its purchases,
 * its usage statistics, its demo shelf, shared links and "Send to Readest".
 */
export const READEST_CLOUD_ENABLED = process.env['NEXT_PUBLIC_CLOUD_ENABLED'] === 'true';

/** Usage statistics never go to Readest's PostHog in this edition. */
export const TELEMETRY_ENABLED = false;

/** Readest's demo shelf (six books from cdn.readest.com) stays off. */
export const DEMO_BOOKS_ENABLED = false;

/** Readest's premium plans are not sold here: the upgrade entry stays hidden. */
export const READEST_PREMIUM_ENABLED = false;

/**
 * "Send to Readest" (books sent by e-mail to an inbox) needs Readest's e-mail
 * worker and the send_* tables: not offered, so the inbox is never polled.
 */
export const SEND_TO_READEST_ENABLED = false;

/**
 * Sign-in by e-mail link and the "forgot password" e-mail need an e-mail
 * sender of our own (custom SMTP on Supabase, which needs a domain). Until
 * then the sign-in page offers e-mail and password only. Turn on with
 * NEXT_PUBLIC_AUTH_EMAILS_ENABLED=true once SMTP is set up.
 */
export const AUTH_EMAILS_ENABLED = process.env['NEXT_PUBLIC_AUTH_EMAILS_ENABLED'] === 'true';

type OAuthProvider = 'google' | 'apple' | 'facebook' | 'github' | 'discord';
const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'apple', 'facebook', 'github', 'discord'];

/**
 * Sign-in providers configured on Ouiread's Supabase, as a comma-separated
 * list in NEXT_PUBLIC_AUTH_PROVIDERS (for example "google"). None yet.
 */
export const AUTH_OAUTH_PROVIDERS: OAuthProvider[] = (
  process.env['NEXT_PUBLIC_AUTH_PROVIDERS'] || ''
)
  .split(',')
  .map((p) => p.trim())
  .filter((p): p is OAuthProvider => OAUTH_PROVIDERS.includes(p as OAuthProvider));

/**
 * The voice that reads first. Fish Audio's free model is meant for personal
 * use, so a voice sold on the stores cannot lean on it: this edition reads with
 * Edge's voices (or the phone's own) by default, and Fish stays one tap away in
 * the voice menu wherever the relay is set up. Turn this on with a paid Fish
 * plan behind the subscription.
 */
export const FISH_VOICE_BY_DEFAULT = false;

/**
 * Paid plans (Stripe on the web): on once the Stripe account, its prices and
 * the server secrets are in place (GitHub variable OUIREAD_PAYMENTS_ENABLED).
 */
export const PAYMENTS_ENABLED = process.env['NEXT_PUBLIC_PAYMENTS_ENABLED'] === 'true';
