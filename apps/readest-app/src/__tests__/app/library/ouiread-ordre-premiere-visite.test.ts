import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({ isWebAppPlatform: () => true }));

import {
  marquerTutorielVu,
  noterVisiteLecteurAFaire,
  tutorielAMontrer,
  tutorielVisiteurAMontrer,
  visiteLecteurAFaire,
  visiteLecteurFaite,
} from '@/app/library/utils/tutoriel';

// An in-memory browser storage (the test environment's own has no clear()).
const memoire = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, String(v)),
  removeItem: (k: string) => void memoire.delete(k),
  clear: () => memoire.clear(),
});

const ilYa = (ms: number) => new Date(Date.now() - ms).toISOString();
const HEURE = 60 * 60 * 1000;
const neuf = (id: string) => ({ id, created_at: ilYa(2 * 60 * 1000) });

beforeEach(() => localStorage.clear());

describe('a visitor gets the tour after the gift window', () => {
  it('once on this browser', () => {
    expect(tutorielVisiteurAMontrer()).toBe(true);
    marquerTutorielVu(null);
    expect(tutorielVisiteurAMontrer()).toBe(false);
  });

  it('also on a browser that saw the tour of 26 Nov (shown on arrival)', () => {
    localStorage.setItem('lel-tutoriel-vu', '2026-11-26');
    localStorage.setItem('lel-visite-lecteur-vue', '2026-11-26');
    expect(tutorielVisiteurAMontrer()).toBe(true);
    noterVisiteLecteurAFaire(null);
    expect(visiteLecteurAFaire(null)).toBe(true);
  });
});

describe('a new account gets the tour right after its sign-up', () => {
  it('a visitor is not an account', () => {
    expect(tutorielAMontrer(null)).toBe(false);
  });

  it('once per account on this browser', () => {
    expect(tutorielAMontrer(neuf('a'))).toBe(true);
    marquerTutorielVu('a');
    expect(tutorielAMontrer(neuf('a'))).toBe(false);
    expect(tutorielAMontrer(neuf('b'))).toBe(true);
  });

  it('not twice for the visitor who had it a moment ago and then signed up', () => {
    marquerTutorielVu(null);
    noterVisiteLecteurAFaire(null);
    expect(tutorielAMontrer(neuf('moi'))).toBe(false);
    // What was due as a visitor is the account's now.
    expect(visiteLecteurAFaire('moi')).toBe(true);
    expect(visiteLecteurAFaire(null)).toBe(false);
    // Another new account later on this browser gets its own tour.
    expect(tutorielAMontrer(neuf('autre'))).toBe(true);
  });

  it('not for an older account signing in on a new device', () => {
    expect(tutorielAMontrer({ id: 'ancien', created_at: ilYa(3 * 24 * HEURE) })).toBe(false);
  });

  it('reads the dates Supabase gives (six decimals)', () => {
    const iso = ilYa(HEURE).replace(/\.(\d{3})Z$/, '.$1456Z');
    expect(tutorielAMontrer({ id: 'micro', created_at: iso })).toBe(true);
  });

  it('not for an account without a date', () => {
    expect(tutorielAMontrer({ id: 'sans-date' })).toBe(false);
  });
});

describe('the reader tour comes on the first book after the tour', () => {
  it('is not due before the tour ends', () => {
    expect(visiteLecteurAFaire(null)).toBe(false);
    expect(visiteLecteurAFaire('a')).toBe(false);
  });

  it('is due after it, for that person only, and shown once', () => {
    noterVisiteLecteurAFaire('a');
    expect(visiteLecteurAFaire('a')).toBe(true);
    expect(visiteLecteurAFaire('b')).toBe(false);
    visiteLecteurFaite('a');
    expect(visiteLecteurAFaire('a')).toBe(false);
    // « Revoir le tutoriel » does not bring it back.
    noterVisiteLecteurAFaire('a');
    expect(visiteLecteurAFaire('a')).toBe(false);
  });
});
