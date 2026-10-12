import { getRelayUrl, isAIPaused, postToRelay, relayError } from './relay';

// AI proofreading of the page being read (relay route /v1/proofread, Workers
// AI, Mistral Small 3.1): it spots what converting a printed book to EPUB broke
// — typos, doubled or missing words, OCR confusions, leftover hyphenation —
// and proposes find/replace pairs; the reader keeps or ignores them.
//
// Measured 12 Oct 2026: a trap page (~560 chars) came back with its 6 real
// errors ("the the", "rnorning", "vvind", "some- thing", "al1", "room ,") and
// one debatable change ("could of"); a clean page (~770 chars) with none,
// twice; ~20 neurons per page either way, 3-4 s.

export interface AICorrection {
  /** Index of the paragraph in the request. */
  p: number;
  find: string;
  replace: string;
}

// The free allocation (10,000 neurons a day) is shared with the AI
// translation: proofreading stops at this many per UTC day and leaves the rest
// to it (about 150-200 pages at ~20-25 neurons each).
export const PROOFREAD_DAILY_NEURONS = 4000;
// Used when the relay does not report usage, so the budget still moves.
const FALLBACK_NEURONS_PER_PAGE = 25;
const TIMEOUT_MS = 30_000;

const NEURONS_KEY_PREFIX = 'ai-proofread-neurons:';
const todayKey = (now = Date.now()) =>
  `${NEURONS_KEY_PREFIX}${new Date(now).toISOString().slice(0, 10)}`;

export const neuronsUsedToday = (now = Date.now()): number => {
  try {
    return Number(localStorage.getItem(todayKey(now))) || 0;
  } catch {
    return 0;
  }
};

const addNeurons = (neurons: number, now = Date.now()) => {
  try {
    const key = todayKey(now);
    // One counter per UTC day; earlier days are dead weight.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(NEURONS_KEY_PREFIX) && k !== key) localStorage.removeItem(k);
    }
    localStorage.setItem(key, String(neuronsUsedToday(now) + neurons));
  } catch {
    // Storage unavailable: the relay's own daily allocation still bounds it.
  }
};

export const canProofread = () =>
  !!getRelayUrl() && !isAIPaused() && neuronsUsedToday() < PROOFREAD_DAILY_NEURONS;

export const requestProofread = async (paragraphs: string[]): Promise<AICorrection[]> => {
  const response = await postToRelay('/v1/proofread', { paragraphs }, TIMEOUT_MS);
  if (!response.ok) throw await relayError(response, 'AI proofreading');
  const data = (await response.json()) as {
    corrections?: unknown;
    usage?: { neurons?: unknown } | null;
  };
  const neurons = Number(data.usage?.neurons);
  addNeurons(Number.isFinite(neurons) && neurons > 0 ? neurons : FALLBACK_NEURONS_PER_PAGE);
  const list = Array.isArray(data.corrections) ? data.corrections : [];
  return list.filter(
    (c): c is AICorrection =>
      !!c &&
      Number.isInteger((c as AICorrection).p) &&
      typeof (c as AICorrection).find === 'string' &&
      typeof (c as AICorrection).replace === 'string',
  );
};

// What became of each paragraph already sent, keyed by a hash of its text, per
// book: 'clean' (nothing to fix), 'decided' (the reader kept or ignored the
// proposals) or the proposals still awaiting an answer — so a page is never
// paid for twice and unanswered proposals come back with the page.
export interface PendingCorrection {
  find: string;
  replace: string;
}
export type ParagraphState = 'clean' | 'decided' | PendingCorrection[];

// localStorage stays small: a hash and a few short strings per paragraph.
const MAX_REMEMBERED = 3000;
const statesKey = (bookHash: string) => `ai-proofread:${bookHash}`;

export const loadParagraphStates = (bookHash: string): Record<string, ParagraphState> => {
  try {
    const raw = localStorage.getItem(statesKey(bookHash));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ParagraphState>) : {};
  } catch {
    return {};
  }
};

export const saveParagraphStates = (bookHash: string, states: Record<string, ParagraphState>) => {
  const entries = Object.entries(states);
  const kept = entries.length > MAX_REMEMBERED ? entries.slice(-MAX_REMEMBERED) : entries;
  try {
    localStorage.setItem(statesKey(bookHash), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Full storage: the worst case is re-checking a page.
  }
};

const offKey = (bookHash: string) => `ai-proofread-off:${bookHash}`;
export const isProofreadOff = (bookHash: string) => {
  try {
    return localStorage.getItem(offKey(bookHash)) === '1';
  } catch {
    return false;
  }
};
export const setProofreadOff = (bookHash: string) => {
  try {
    localStorage.setItem(offKey(bookHash), '1');
  } catch {
    // Nothing to do: the bar is simply shown again next time.
  }
};
