import { filterSSMLWithLang, parseSSMLMarks } from '@/utils/ssml';
import { TTSMark } from './types';

// Sentence and paragraph steps over foliate's TTS cursor (foliate-js/tts.js)
// that stop only where the voice reads.
//
// foliate steps over every mark it segmented, and the voice does not read all
// of them. In translation mode a paragraph holds its English sentences, then
// the French ones, then the blank before the next paragraph, each with its own
// mark; only the French is read. Reported 16 Oct 2026 ("j'ai raté une phrase…
// la navigation est compliquée pour y revenir"), and measured on such a page:
//   - "previous sentence" on a paragraph's first French sentence landed on an
//     English one, which is read as the same French paragraph from its start:
//     the paragraph before could never be reached;
//   - "next sentence" on a paragraph's last French sentence landed on the blank
//     after it, and nothing was read;
//   - at the start of a paragraph, before its first sentence was reported,
//     "next sentence" left for the paragraph after, skipping a whole one.

/** The part of foliate's TTS that the steps move. */
export interface TTSCursor {
  start(): string | undefined;
  next(paused?: boolean): string | undefined;
  prev(paused?: boolean): string | undefined;
  nextMark(paused?: boolean): string | undefined;
  prevMark(paused?: boolean): string | undefined;
  resume(): string | undefined;
  getLastRange(): Range | undefined;
}

/** The sentences the voice reads in an SSML, in order. */
export type SpokenMarks = (ssml: string) => TTSMark[];

// A scene break ("* * *") has nothing to say: the controller turns its stars
// into spaces before speaking.
const hasWords = (mark: TTSMark) => /[\p{L}\p{N}]/u.test(mark.text);

/**
 * What TTSController reads of an SSML. In translation mode, the translated
 * sentences; a paragraph not translated yet is read from its source sentences,
 * which the controller translates itself.
 */
export const spokenMarks = (ssml: string, targetLang?: string): TTSMark[] => {
  if (targetLang) {
    const marks = parseSSMLMarks(filterSSMLWithLang(ssml, targetLang)).marks.filter(hasWords);
    if (marks.length > 0) return marks;
  }
  return parseSSMLMarks(ssml).marks.filter(hasWords);
};

/** Stands the cursor on a mark of its paragraph, without drawing it. */
export type PlaceMark = (name: string) => void;

export interface TTSStep {
  /** What to speak from the step. */
  ssml: string;
  /** The first sentence read there. */
  mark: TTSMark;
}

// Each step costs at most one paragraph's segmentation; no chapter has this many.
const MAX_STEPS = 5000;

const firstMarkName = (ssml: string | undefined) =>
  ssml ? /<mark\b[^>]*\bname="([^"]*)"/.exec(ssml)?.[1] : undefined;

/** The mark the cursor stands on; undefined at the start of a paragraph. */
export const currentMarkName = (tts: TTSCursor) =>
  tts.getLastRange() ? firstMarkName(tts.resume()) : undefined;

/** One sentence forward or back to the next one read; undefined at the chapter's edge. */
export const stepSentence = (
  tts: TTSCursor,
  dir: 1 | -1,
  spoken: SpokenMarks,
  place: PlaceMark,
): TTSStep | undefined => {
  if (dir > 0 && !tts.getLastRange()) {
    // Its first sentence not reported yet, foliate would leave the paragraph:
    // stand on that sentence, so the step goes to the one after it.
    const first = spoken(tts.resume() ?? '')[0];
    if (first) place(first.name);
  }
  for (let i = 0; i < MAX_STEPS; i++) {
    const ssml = dir > 0 ? tts.nextMark() : tts.prevMark();
    if (!ssml) {
      // The chapter's edge, unless this paragraph has no mark at all.
      if (firstMarkName(tts.resume()) !== undefined) return undefined;
      const entered = dir > 0 ? tts.next() : tts.prev();
      if (!entered) return undefined;
      const marks = spoken(entered);
      const mark = dir > 0 ? marks[0] : marks[marks.length - 1];
      if (!mark) continue;
      place(mark.name);
      return { ssml: tts.resume() ?? entered, mark };
    }
    // A stop is read when the voice starts on it, not on a sentence after it.
    const mark = spoken(ssml)[0];
    if (mark && mark.name === firstMarkName(ssml)) return { ssml, mark };
  }
  return undefined;
};

/** One paragraph forward or back to the next one with something read. */
export const stepParagraph = (
  tts: TTSCursor,
  dir: 1 | -1,
  spoken: SpokenMarks,
): TTSStep | undefined => {
  for (let i = 0; i < MAX_STEPS; i++) {
    const ssml = dir > 0 ? tts.next() : tts.prev();
    if (!ssml) return undefined;
    const mark = spoken(ssml)[0];
    if (mark) return { ssml, mark };
  }
  return undefined;
};

/** The chapter's first sentence read. */
export const firstStep = (tts: TTSCursor, spoken: SpokenMarks): TTSStep | undefined => {
  const ssml = tts.start();
  if (!ssml) return undefined;
  const mark = spoken(ssml)[0];
  return mark ? { ssml, mark } : stepParagraph(tts, 1, spoken);
};

/** The chapter's last paragraph read, or its last sentence read (`bySentence`). */
export const lastStep = (
  tts: TTSCursor,
  spoken: SpokenMarks,
  place: PlaceMark,
  bySentence: boolean,
): TTSStep | undefined => {
  let ssml = tts.start();
  for (let next = tts.next(); next; next = tts.next()) ssml = next;
  let marks = ssml ? spoken(ssml) : [];
  if (!ssml || marks.length === 0) {
    const step = stepParagraph(tts, -1, spoken);
    if (!step) return undefined;
    ssml = step.ssml;
    marks = spoken(ssml);
  }
  const mark = bySentence ? marks[marks.length - 1]! : marks[0]!;
  if (!bySentence) return { ssml, mark };
  place(mark.name);
  return { ssml: tts.resume() ?? ssml, mark };
};
