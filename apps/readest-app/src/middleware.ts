import { NextRequest, NextResponse } from 'next/server';

const allowedOrigins = [
  'https://web.readest.com',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'http://localhost:3000',
  'http://localhost:3001',
  'tauri://localhost',
];

const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

// Lis et Lead lives at lisetlead.com: www and the .app domain lead there, and
// so does the first address (workers.dev) for pages, so that links already
// shared keep working while every reader ends up on one origin (one login,
// one local library). The API answers on every address.
const CANONICAL_HOST = 'lisetlead.com';
const REDIRECTED_HOSTS = [
  'www.lisetlead.com',
  'lisetlead.app',
  'www.lisetlead.app',
  'ouiread.damien-aure99c.workers.dev',
];

// The scheme the visitor really used, as Cloudflare's edge saw it (cf-visitor,
// x-forwarded-proto). Without either header (local dev, tests) it is unknown,
// and nothing is redirected: a wrong guess here would loop forever.
const visitorScheme = (request: NextRequest) => {
  const visitor = request.headers.get('cf-visitor');
  if (visitor) return visitor.includes('"http"') ? 'http' : 'https';
  return request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() ?? null;
};

export function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');
  const host = (request.headers.get('host') || '').toLowerCase();
  // One address per page for search engines (27 Nov 2026, référencement): http://lisetlead.com
  // answered the same pages as https://, a duplicate of the whole site.
  const plainHttp = host === CANONICAL_HOST && visitorScheme(request) === 'http';
  if (!isApi && (REDIRECTED_HOSTS.includes(host) || plainHttp)) {
    const target = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      `https://${CANONICAL_HOST}`,
    );
    return NextResponse.redirect(target, 301);
  }

  if (isApi) {
    const origin = request.headers.get('origin') ?? '';
    const isAllowedOrigin = allowedOrigins.includes(origin);

    if (request.method === 'OPTIONS') {
      const preflightHeaders = new Headers({
        ...corsOptions,
        ...(isAllowedOrigin && { 'Access-Control-Allow-Origin': origin }),
      });

      return new NextResponse(null, {
        status: 200,
        headers: preflightHeaders,
      });
    }

    const response = NextResponse.next();

    if (isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }

    Object.entries(corsOptions).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  // Cross-origin isolation enables SharedArrayBuffer, which the Turso WASM
  // thread pool requires (initThreadPool hangs without it). Set on every
  // document response, not just /api/* — `crossOriginIsolated` is a property
  // of the top-level browsing context, determined by the document's headers.
  const response = NextResponse.next();
  // Browsers that came once over https keep to it (no subdomains: maj.lisetlead.com is its own).
  if (host === CANONICAL_HOST && visitorScheme(request) === 'https') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // The /s share landing embeds the book cover via an <img> that redirects to a
  // cross-origin R2 presigned URL. Under COEP: require-corp the browser blocks
  // that image, because R2 can't attach a Cross-Origin-Resource-Policy header to
  // a presigned GET. `credentialless` keeps the page cross-origin isolated — so
  // EnvContext can still boot the Turso replica (SharedArrayBuffer) here when the
  // user has sync enabled — while dropping the CORP requirement for no-cors
  // subresources, letting the cover load with no client-side change. Every other
  // route keeps the stricter require-corp.
  const path = request.nextUrl.pathname;
  const coep = path === '/s' || path.startsWith('/s/') ? 'credentialless' : 'require-corp';
  response.headers.set('Cross-Origin-Embedder-Policy', coep);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json).*)'],
};
