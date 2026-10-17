import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The reader's translator, asked by the voice for the paragraphs it is about
// to read ('translate-blocks', see TTSController#bringTranslation): with the
// screen off, the page shows nothing new, and these are all it translates.

const viewSettings = {
  translationEnabled: true,
  translationProvider: 'ai',
  translateTargetLang: 'fr',
  showTranslateSource: true,
  proofreadRules: [],
};

vi.mock('@/store/readerStore', () => {
  const state = { getViewSettings: () => viewSettings, setIsLoading: () => {} };
  return { useReaderStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
const translate = vi.fn(async (texts: string[]) => texts.map((t) => `FR ${t}`));
vi.mock('@/hooks/useTranslator', () => ({ useTranslator: () => ({ translate }) }));
vi.mock('@/services/transformers/proofread', () => ({
  applyRulesToText: (text: string) => text,
  getCorrectionRules: () => [],
}));

import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';
import { eventDispatcher } from '@/utils/event';
import { FoliateView } from '@/types/view';

const makeDoc = () =>
  new DOMParser().parseFromString(
    '<!DOCTYPE html><html lang="en"><body><p>One is here.</p><p>Two is here.</p></body></html>',
    'text/html',
  );

// A foliate view: an element with a renderer.
const makeView = () => {
  const view = document.createElement('div');
  Object.assign(view, { renderer: {} });
  return view as unknown as FoliateView;
};

const french = (p: Element) => p.querySelector('.translation-target')?.textContent;

describe('paragraphs the voice asks for', () => {
  beforeEach(() => {
    translate.mockClear();
    // The table of contents' translator watches what is visible.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('puts the translation in the page before answering, when the voice waits', async () => {
    const view = makeView();
    renderHook(() => useTextTranslation('book-1', view));
    const doc = makeDoc();
    const [one, two] = Array.from(doc.querySelectorAll('p'));
    await eventDispatcher.dispatch('translate-blocks', {
      bookKey: 'book-1',
      elements: [one],
      now: true,
    });
    expect(french(one!)).toBe('FR One is here.');
    expect(one!.querySelector('.translation-target')?.getAttribute('lang')).toBe('fr');
    expect(french(two!)).toBeUndefined();
  });

  it('translates the ones the voice reads next without making it wait', async () => {
    const view = makeView();
    renderHook(() => useTextTranslation('book-1', view));
    const doc = makeDoc();
    const paragraphs = Array.from(doc.querySelectorAll('p'));
    let answer = () => {};
    translate.mockImplementationOnce(
      (texts: string[]) =>
        new Promise((resolve) => (answer = () => resolve(texts.map((t) => `FR ${t}`)))),
    );
    // Answered before the translation comes back.
    await eventDispatcher.dispatch('translate-blocks', {
      bookKey: 'book-1',
      elements: paragraphs,
      now: false,
    });
    expect(french(paragraphs[0]!)).toBeUndefined();
    answer();
    await vi.waitFor(() =>
      expect(paragraphs.map(french)).toEqual(['FR One is here.', 'FR Two is here.']),
    );
  });

  it('asks the translator once for a paragraph asked for again meanwhile', async () => {
    const view = makeView();
    renderHook(() => useTextTranslation('book-1', view));
    const doc = makeDoc();
    const [one] = Array.from(doc.querySelectorAll('p'));
    await Promise.all([
      eventDispatcher.dispatch('translate-blocks', { bookKey: 'book-1', elements: [one] }),
      eventDispatcher.dispatch('translate-blocks', { bookKey: 'book-1', elements: [one] }),
      eventDispatcher.dispatch('translate-blocks', {
        bookKey: 'book-1',
        elements: [one],
        now: true,
      }),
    ]);
    expect(french(one!)).toBe('FR One is here.');
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('leaves another book’s paragraphs, and a translated one, alone', async () => {
    const view = makeView();
    renderHook(() => useTextTranslation('book-1', view));
    const doc = makeDoc();
    const [one] = Array.from(doc.querySelectorAll('p'));
    await eventDispatcher.dispatch('translate-blocks', {
      bookKey: 'book-2',
      elements: [one],
      now: true,
    });
    expect(french(one!)).toBeUndefined();
    await eventDispatcher.dispatch('translate-blocks', {
      bookKey: 'book-1',
      elements: [one],
      now: true,
    });
    await eventDispatcher.dispatch('translate-blocks', {
      bookKey: 'book-1',
      elements: [one],
      now: true,
    });
    expect(one!.querySelectorAll('.translation-target-block')).toHaveLength(1);
  });

  it('is not the table of contents’ translator', async () => {
    const toc = document.createElement('div');
    renderHook(() => useTextTranslation('book-1', toc));
    const doc = makeDoc();
    const [one] = Array.from(doc.querySelectorAll('p'));
    await eventDispatcher.dispatch('translate-blocks', {
      bookKey: 'book-1',
      elements: [one],
      now: true,
    });
    expect(french(one!)).toBeUndefined();
  });
});
