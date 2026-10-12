import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.hoisted(() => {
  process.env['NEXT_PUBLIC_FISH_RELAY_URL'] = 'https://relay.test';
  process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] = 'token';
});

const mockFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => mockFetch(...a) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
let location = 'page-1';
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => ({ location }) }));
const addRule = vi.fn(async () => ({}));
vi.mock('@/store/proofreadStore', () => ({
  useProofreadStore: (select: (s: { addRule: typeof addRule }) => unknown) => select({ addRule }),
}));

import { useAIProofread } from '@/app/reader/hooks/useAIProofread';
import { resetAIPause } from '@/services/ai/relay';
import { paragraphText } from '@/utils/aiProofreadDom';
import type { FoliateView } from '@/types/view';

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

const answer = (body: object) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const setUpPage = () => {
  document.body.innerHTML = `
    <p id="a">Tom picked up the
      the phone, but his hands were shaking.</p>
    <p id="b">The morning was cold and the vvind blew hard.</p>`;
  const range = document.createRange();
  range.selectNodeContents(document.body);
  return {
    current: {
      lastLocation: { range },
      renderer: { getContents: () => [{ doc: document }] },
    } as unknown as FoliateView,
  };
};

const BOOK = 'book1-view1';

describe('useAIProofread', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', memoryStorage());
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    mockFetch.mockReset();
    addRule.mockClear();
    resetAIPause();
    location = 'page-1';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('proposes corrections after a dwell, then keeps them for good', async () => {
    const viewRef = setUpPage();
    mockFetch.mockResolvedValueOnce(
      answer({
        corrections: [
          { p: 0, find: 'the the phone', replace: 'the phone' },
          { p: 1, find: 'vvind', replace: 'wind' },
        ],
        usage: { neurons: 20 },
      }),
    );
    const { result } = renderHook(() => useAIProofread(BOOK, viewRef));

    // Nothing is spent on a page just glanced at.
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mockFetch).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.proposals.map((p) => p.replace)).toEqual(['the phone', 'wind']);
    // The proposal carries the book's own text, line break included.
    expect(result.current.proposals[0]!.find).toMatch(/^the\s+the phone$/);

    await act(() => result.current.keep());

    expect(result.current.proposals).toEqual([]);
    expect(paragraphText(document.getElementById('a')!)).toBe(
      'Tom picked up the phone, but his hands were shaking.',
    );
    expect(paragraphText(document.getElementById('b')!)).toBe(
      'The morning was cold and the wind blew hard.',
    );
    expect(addRule).toHaveBeenCalledTimes(2);
    expect(addRule).toHaveBeenCalledWith({}, BOOK, {
      scope: 'book',
      pattern: 'vvind',
      replacement: 'wind',
      isRegex: false,
      caseSensitive: true,
      wholeWord: false,
    });
  });

  it('asks the AI once per paragraph: unanswered proposals come back with the page', async () => {
    const viewRef = setUpPage();
    mockFetch.mockResolvedValueOnce(
      answer({ corrections: [{ p: 1, find: 'vvind', replace: 'wind' }], usage: { neurons: 20 } }),
    );
    const { result, rerender } = renderHook(() => useAIProofread(BOOK, viewRef));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.proposals).toHaveLength(1);

    // Turned the page without answering, then came back.
    location = 'page-2';
    rerender();
    expect(result.current.proposals).toEqual([]);
    location = 'page-1';
    rerender();
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(result.current.proposals.map((p) => p.find)).toEqual(['vvind']);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Ignored: never proposed again, never paid for again.
    act(() => result.current.ignore());
    location = 'page-3';
    rerender();
    location = 'page-1';
    rerender();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.proposals).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('spends nothing while the screen is off', async () => {
    const viewRef = setUpPage();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    renderHook(() => useAIProofread(BOOK, viewRef));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stays quiet for a book where it was turned off', async () => {
    const viewRef = setUpPage();
    mockFetch.mockResolvedValueOnce(
      answer({ corrections: [{ p: 1, find: 'vvind', replace: 'wind' }], usage: { neurons: 20 } }),
    );
    const { result, rerender } = renderHook(() => useAIProofread(BOOK, viewRef));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    act(() => result.current.turnOff());

    document.getElementById('b')!.textContent = 'Another page with a new tpyo in it.';
    location = 'page-2';
    rerender();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.proposals).toEqual([]);
  });
});
