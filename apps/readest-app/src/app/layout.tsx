import * as React from 'react';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ViewTransitions } from 'next-view-transitions';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';
import MesureAudience from '@/components/MesureAudience';

import '@fontsource-variable/dm-sans';
import '@fontsource-variable/bricolage-grotesque';
import '../styles/globals.css';
import '../styles/identity.css';

// Ouiread's own address (the web build bakes NEXT_PUBLIC_API_BASE_URL).
const url = `${(process.env['NEXT_PUBLIC_API_BASE_URL'] || 'https://ouiread.damien-aure99c.workers.dev').replace(/\/$/, '')}/`;
const title = 'Lis et Lead — la liseuse qui traduit et lit vos livres';
const description =
  'Lis et Lead traduit vos livres en français et vous les lit à voix haute. ' +
  'Votre bibliothèque vous suit sur tous vos appareils, et un livre vous est offert ' +
  'à l’inscription : « Ça marche ».';
const previewImage = '/og-ouiread.png';

// Who Lis et Lead is, for search engines and AI assistants, on every page (owner's ask of
// 27 Nov 2026, référencement). Pages say more and point here by @id (app/decouvrir).
const QUI = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${url}#organisation`,
      name: 'Lis et Lead',
      url,
      logo: `${url}icon.png`,
      email: 'contact@lisetlead.com',
    },
    {
      '@type': 'WebSite',
      '@id': `${url}#site`,
      name: 'Lis et Lead',
      url,
      inLanguage: 'fr',
      publisher: { '@id': `${url}#organisation` },
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: title,
    template: '%s | Lis et Lead',
  },
  description,
  generator: 'Next.js',
  // « ?v=3 » (26/11/2026, icônes bleu nuit ; ?v=2 le 23/11) : une adresse neuve, que l'ancien cache hors ligne ne connaît
  // pas ; un visiteur qui revient voit le logo Lis et Lead dès sa première visite.
  manifest: '/manifest.json?v=3',
  keywords: [
    'liseuse en ligne',
    'traduire un livre en français',
    'lire un livre en anglais',
    'lecture à voix haute',
    'livre audio',
    'epub',
    'pdf',
  ],
  authors: [
    {
      name: 'Lis et Lead',
      url,
    },
  ],
  icons: {
    icon: [
      { url: '/favicon.ico?v=3', sizes: '48x48' },
      { url: '/icon-192.png?v=3', type: 'image/png', sizes: '192x192' },
      { url: '/icon.png?v=3', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png?v=3', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Lis et Lead',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    url,
    title,
    description,
    locale: 'fr_FR',
    siteName: 'Lis et Lead',
    images: [{ url: previewImage, width: 1200, height: 630, alt: 'Lis et Lead' }],
  },
  // Google Search Console, property https://lisetlead.com/ on the owner's account
  // (27 Nov 2026). Keep it: removing it loses the property's proof of ownership.
  verification: { google: 'MSqaOzbQNWOArUnQLU04Gt0xOa-bt5LFkgdK2OeLr44' },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [previewImage],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'twitter:domain': new URL(url).host,
    'twitter:url': url,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // `interactive-widget=resizes-content` is appended client-side on
  // Android only — see Providers.tsx. Other browsers warn about the
  // unrecognized key on every page load, so we keep it out of SSR.
};

// In Tauri mobile dev the page origin doesn't match the dev server, so
// Next.js's `getSocketUrl` builds an unreachable HMR URL (see
// `next/dist/client/dev/hot-reloader/get-socket-url.js`):
//   - iOS sim:        page at `tauri://localhost`        → `wss://localhost/_next/...`
//     (no port, non-http scheme falls through to `wss:`)
//   - Android emul.:  page at `http://tauri.localhost`   → `ws://tauri.localhost/_next/...`
//     (`tauri.localhost` is intercepted by Tauri's asset handler, but
//     WebSocket frames bypass the interceptor and the dev server is on the
//     host machine, reachable from the emulator as `10.0.2.2`)
// Rewrite the WebSocket constructor before the HMR client runs.
// When `--host <ip>` is passed, tauri-cli exports `TAURI_DEV_HOST=<ip>`
// before invoking `beforeDevCommand`, so we forward that as `devHost` and
// use it for the rewrite (the dev server must also bind to the same address
// — typically `next dev -H 0.0.0.0`).
function patchTauriHmrWebSocket(devHost?: string) {
  const isIosTauriProxy = location.protocol === 'tauri:' && location.hostname === 'localhost';
  const isAndroidTauriProxy =
    location.protocol === 'http:' && location.hostname === 'tauri.localhost';
  if (!isIosTauriProxy && !isAndroidTauriProxy) return;

  // Priority: explicit --host > platform default loopback alias.
  // iOS Simulator can reach the host's localhost directly.
  // Android emulator reaches the host machine via 10.0.2.2.
  const hmrHost = devHost
    ? `${devHost}:3000`
    : isIosTauriProxy
      ? 'localhost:3000'
      : '10.0.2.2:3000';
  const brokenHostPattern = /^wss?:\/\/(localhost|tauri\.localhost)(?=\/_next\/)/;

  const OriginalWebSocket = window.WebSocket;
  class PatchedWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = url instanceof URL ? url.href : url;
      const rewritten =
        typeof urlStr === 'string' && brokenHostPattern.test(urlStr)
          ? urlStr.replace(brokenHostPattern, `ws://${hmrHost}`)
          : url;
      super(rewritten, protocols);
    }
  }
  window.WebSocket = PatchedWebSocket;
}

const shouldInjectDevHmrPatch =
  process.env['NODE_ENV'] === 'development' && process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
const devHmrPatchScript = `(${patchTauriHmrWebSocket.toString()})(${JSON.stringify(
  process.env['TAURI_DEV_HOST'],
)});`;

// `/runtime-config.js` is a dynamic route handler that only exists in the
// web/Docker build. The Tauri build is statically exported (`output:
// 'export'`), so the file isn't emitted — the request would return the SPA
// fallback HTML and crash with `Unexpected token '<'`. All runtime-config
// consumers fall back to `NEXT_PUBLIC_*` envs baked at build time on Tauri.
const shouldInjectRuntimeConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // French: the site is in French (search engines and AI assistants read this).
    <html
      lang='fr'
      className={process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' ? 'edge-to-edge' : ''}
    >
      <head>
        {shouldInjectRuntimeConfig ? (
          <Script src='/runtime-config.js' strategy='beforeInteractive' />
        ) : null}
        {shouldInjectDevHmrPatch ? (
          <script dangerouslySetInnerHTML={{ __html: devHmrPatchScript }} />
        ) : null}
      </head>
      <body>
        <ViewTransitions>
          <EnvProvider>
            <Providers>
              <MesureAudience />
              {children}
            </Providers>
          </EnvProvider>
        </ViewTransitions>
        {/* For a browser or a robot without JavaScript (most AI assistants' robots do not run
            it, owner's ask of 27 Nov 2026 for search engines and AI chats): what the site is,
            and the page that tells it in full, drawn on the server (app/decouvrir). Last in
            the page, so that /decouvrir's own text comes first. */}
        <noscript>
          <p style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
            Lis et Lead est une liseuse en ligne qui traduit vos livres en français pendant que vous
            lisez et vous les lit à voix haute. Elle a besoin de JavaScript pour s’ouvrir.{' '}
            <a href='/decouvrir'>Découvrir Lis et Lead</a>
          </p>
        </noscript>
        <script
          type='application/ld+json'
          // Fixed text of our own, not user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(QUI) }}
        />
      </body>
    </html>
  );
}
