import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const coep = (path: string) =>
  middleware(new NextRequest(`http://localhost:3000${path}`)).headers.get(
    'Cross-Origin-Embedder-Policy',
  );

describe('middleware cross-origin isolation headers', () => {
  it('serves COEP credentialless on the /s share landing so the R2 cover <img> loads', () => {
    // The cover redirects to a cross-origin R2 URL that can't carry a CORP
    // header; credentialless keeps the page isolated while allowing it.
    expect(coep('/s')).toBe('credentialless');
    expect(coep('/s/Qmup0X1A8ovl2FmKJKA8mB')).toBe('credentialless');
  });

  it('keeps the stricter require-corp on every other document route', () => {
    expect(coep('/')).toBe('require-corp');
    expect(coep('/library')).toBe('require-corp');
    // Must not be caught by a naive startsWith('/s').
    expect(coep('/settings')).toBe('require-corp');
    expect(coep('/search')).toBe('require-corp');
  });

  it('always pairs COOP same-origin on document responses', () => {
    const res = middleware(new NextRequest('http://localhost:3000/s/tok'));
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('does not put COEP on /api routes', () => {
    const res = middleware(new NextRequest('http://localhost:3000/api/share/tok'));
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBeNull();
  });
});

describe('one address per page (référencement, 27 Nov 2026)', () => {
  const requete = (url: string, headers: Record<string, string>) =>
    middleware(new NextRequest(url, { headers }));

  it('sends plain http on lisetlead.com to https, with the same path', () => {
    const res = requete('http://lisetlead.com/decouvrir?x=1', {
      host: 'lisetlead.com',
      'cf-visitor': '{"scheme":"http"}',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://lisetlead.com/decouvrir?x=1');
  });

  it('also reads x-forwarded-proto', () => {
    const res = requete('http://lisetlead.com/', {
      host: 'lisetlead.com',
      'x-forwarded-proto': 'http',
    });
    expect(res.status).toBe(301);
  });

  it('serves https as it is, and tells the browser to keep to it', () => {
    const res = requete('https://lisetlead.com/decouvrir', {
      host: 'lisetlead.com',
      'cf-visitor': '{"scheme":"https"}',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('never redirects when the scheme is unknown (local dev): no loop possible', () => {
    expect(requete('http://lisetlead.com/', { host: 'lisetlead.com' }).status).toBe(200);
    expect(requete('http://localhost:3000/', { host: 'localhost:3000' }).status).toBe(200);
  });

  it('leaves the API alone (a redirect would turn a POST into a GET)', () => {
    const res = requete('http://lisetlead.com/api/stats/evenement', {
      host: 'lisetlead.com',
      'cf-visitor': '{"scheme":"http"}',
    });
    expect(res.status).not.toBe(301);
  });
});
