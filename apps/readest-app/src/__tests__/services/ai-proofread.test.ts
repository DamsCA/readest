import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env['NEXT_PUBLIC_FISH_RELAY_URL'] = 'https://relay.test';
  process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] = 'token';
});

const mockFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => mockFetch(...a) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));

import {
  PROOFREAD_DAILY_NEURONS,
  canProofread,
  isProofreadOff,
  loadParagraphStates,
  neuronsUsedToday,
  requestProofread,
  saveParagraphStates,
  setProofreadOff,
} from '@/services/ai/proofread';
import { resetAIPause } from '@/services/ai/relay';

const answer = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A plain in-memory Storage: Node 25 swaps jsdom's for a partial one of its own.
const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
};

describe('AI proofreading client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetAIPause();
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the page and keeps only well-formed corrections', async () => {
    mockFetch.mockResolvedValueOnce(
      answer({
        corrections: [
          { p: 0, find: 'the the', replace: 'the' },
          { p: 'x', find: 'a', replace: 'b' },
          { p: 1, find: 3, replace: 'b' },
        ],
        usage: { neurons: 19.9 },
      }),
    );

    const out = await requestProofread(
      ['He picked up the the phone.', 'Fine text here.'],
      ['"tpyo" is not an English word'],
    );

    expect(out).toEqual([{ p: 0, find: 'the the', replace: 'the' }]);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://relay.test/v1/proofread');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      paragraphs: ['He picked up the the phone.', 'Fine text here.'],
      hints: ['"tpyo" is not an English word'],
    });
    expect(neuronsUsedToday()).toBeCloseTo(19.9, 5);
  });

  it('stops once the daily share of the free allocation is spent', async () => {
    mockFetch.mockResolvedValueOnce(
      answer({ corrections: [], usage: { neurons: PROOFREAD_DAILY_NEURONS } }),
    );
    expect(canProofread()).toBe(true);
    await requestProofread(['Some text to read here.']);
    expect(canProofread()).toBe(false);
  });

  it('pauses until 00:00 UTC when the relay reports the allocation used up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));
    mockFetch.mockResolvedValueOnce(answer({ error: 'daily free allocation exhausted' }, 429));

    await expect(requestProofread(['Some text to read here.'])).rejects.toThrow('429');
    expect(canProofread()).toBe(false);

    vi.setSystemTime(new Date('2026-10-13T00:00:01Z'));
    expect(canProofread()).toBe(true);
  });

  it('remembers paragraph outcomes per book and can be turned off per book', () => {
    saveParagraphStates('book1', { h1: 'clean', h2: [{ find: 'al1', replace: 'all' }] });
    expect(loadParagraphStates('book1')).toEqual({
      h1: 'clean',
      h2: [{ find: 'al1', replace: 'all' }],
    });
    expect(loadParagraphStates('book2')).toEqual({});

    expect(isProofreadOff('book1')).toBe(false);
    setProofreadOff('book1');
    expect(isProofreadOff('book1')).toBe(true);
    expect(isProofreadOff('book2')).toBe(false);
  });

  // Seen 16 Oct 2026: the free proofreading's unanswered proposals ("was being
  // acting") came back with their pages after the fix.
  it('drops what an older proofreading left, but not what the reader decided', () => {
    localStorage.setItem(
      'ai-proofread:book1',
      JSON.stringify({
        h1: 'clean',
        h2: [{ find: 'was acting', replace: 'was being acting' }],
        h3: 'decided',
      }),
    );
    expect(loadParagraphStates('book1')).toEqual({ h3: 'decided' });
    // Read again by the present proofreading, it is kept from then on.
    saveParagraphStates('book1', { h3: 'decided', h4: 'clean' });
    expect(loadParagraphStates('book1')).toEqual({ h3: 'decided', h4: 'clean' });
  });

  it('keeps only the most recent 3000 paragraph outcomes', () => {
    const many = Object.fromEntries(
      Array.from({ length: 3100 }, (_, i) => [`h${i}`, 'clean' as const]),
    );
    saveParagraphStates('book1', many);
    const kept = loadParagraphStates('book1');
    expect(Object.keys(kept)).toHaveLength(3000);
    expect(kept['h0']).toBeUndefined();
    expect(kept['h3099']).toBe('clean');
  });
});
