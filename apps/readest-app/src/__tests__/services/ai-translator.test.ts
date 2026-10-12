import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The provider reads the relay address at module load (it is disabled without
// one), so the environment must be set before the import below.
vi.hoisted(() => {
  process.env['NEXT_PUBLIC_FISH_RELAY_URL'] = 'https://relay.test/';
  process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] = 'token';
});

const mockFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => mockFetch(...a) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
const googleTranslate = vi.fn(async (texts: string[]) => texts.map((t) => `G:${t}`));
vi.mock('@/services/translators/providers/google', () => ({
  googleProvider: {
    name: 'google',
    label: 'Google',
    translate: (...a: unknown[]) => googleTranslate(...(a as [string[]])),
  },
}));

import { aiProvider, resetAITranslationPause } from '@/services/translators/providers/ai';

const ok = (translation: string) =>
  new Response(JSON.stringify({ translation }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const refused = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Paragraphs long enough for the AI (titles and labels go to Google).
const ONE = 'The first sentence is here.';
const TWO = 'The second sentence is here.';
const THREE = 'The third sentence is here.';

describe('AI translator (relay /v1/translate)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    googleTranslate.mockClear();
    resetAITranslationPause();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is offered when the relay is configured', () => {
    expect(aiProvider.disabled).toBe(false);
  });

  it('sends each paragraph to the relay with its token and languages', async () => {
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const { text } = JSON.parse(String(init.body));
      return ok(text === "It's raining cats and dogs." ? 'Il pleut des cordes.' : 'Autre.');
    });

    const out = await aiProvider.translate(
      ["It's raining cats and dogs.", '', 'Some other words here.'],
      'AUTO',
      'fr',
    );

    expect(out).toEqual(['Il pleut des cordes.', '', 'Autre.']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://relay.test/v1/translate');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Relay-Token': 'token' });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      source: 'AUTO',
      target: 'fr',
    });
    expect(googleTranslate).not.toHaveBeenCalled();
  });

  it('hands a failed paragraph to Google, keeping the others', async () => {
    mockFetch
      .mockResolvedValueOnce(ok('Un.'))
      .mockResolvedValueOnce(refused(502, 'translation too long'))
      .mockRejectedValueOnce(new TypeError('network down'));

    const out = await aiProvider.translate([ONE, TWO, THREE], 'en', 'fr');

    expect(out[0]).toBe('Un.');
    expect(out.slice(1).sort()).toEqual([`G:${THREE}`, `G:${TWO}`].sort());
  });

  it('sends titles and other texts under 4 words straight to Google', async () => {
    // "The Call" once came back from the model as a whole invented page.
    const out = await aiProvider.translate(['The Call', '12', 'Chapter One'], 'en', 'fr');

    expect(out).toEqual(['G:The Call', 'G:12', 'G:Chapter One']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stops asking the AI until 00:00 UTC once the free allocation is used up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));
    mockFetch.mockResolvedValueOnce(refused(429, 'daily free allocation exhausted'));

    expect(await aiProvider.translate([ONE], 'en', 'fr')).toEqual([`G:${ONE}`]);
    // Same day: straight to Google, no round trip to the relay.
    expect(await aiProvider.translate([TWO], 'en', 'fr')).toEqual([`G:${TWO}`]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-13T00:00:01Z'));
    mockFetch.mockResolvedValueOnce(ok('Trois.'));
    expect(await aiProvider.translate([THREE], 'en', 'fr')).toEqual(['Trois.']);
  });

  it('a plain rate limit does not pause the AI', async () => {
    mockFetch
      .mockResolvedValueOnce(refused(429, 'rate limited'))
      .mockResolvedValueOnce(ok('Deux.'));

    expect(await aiProvider.translate([ONE], 'en', 'fr')).toEqual([`G:${ONE}`]);
    expect(await aiProvider.translate([TWO], 'en', 'fr')).toEqual(['Deux.']);
  });

  it('shares one request when the same paragraph is asked for twice at once', async () => {
    let release: () => void = () => {};
    mockFetch.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(ok('Un.')))),
    );

    const first = aiProvider.translate([ONE], 'en', 'fr');
    const second = aiProvider.translate([ONE], 'en', 'fr');
    await Promise.resolve();
    release();

    expect(await first).toEqual(['Un.']);
    expect(await second).toEqual(['Un.']);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Once settled, a later ask goes out again.
    mockFetch.mockResolvedValueOnce(ok('Encore.'));
    expect(await aiProvider.translate([ONE], 'en', 'fr')).toEqual(['Encore.']);
  });

  it('keeps at most 4 requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ok('x');
    });

    const out = await aiProvider.translate(
      Array.from({ length: 10 }, (_, i) => `Paragraph number ${i} is here.`),
      'en',
      'fr',
    );

    expect(out).toHaveLength(10);
    expect(peak).toBe(4);
  });
});
