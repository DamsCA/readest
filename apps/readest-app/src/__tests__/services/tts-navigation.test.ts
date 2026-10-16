import { describe, it, expect, vi } from 'vitest';
import { TTS } from 'foliate-js/tts.js';
import { createRejectFilter } from '@/utils/node';
import { ttsTextWalker } from '@/utils/ttsTextWalker';
import { createTranslationWrapper } from '@/utils/translationDom';
import {
  currentMarkName,
  firstStep,
  lastStep,
  spokenMarks,
  stepParagraph,
  stepSentence,
  TTSCursor,
  TTSStep,
} from '@/services/tts/ttsNavigation';

// Navigation over the real foliate TTS and a page as the reader leaves it once
// the translation is injected: each paragraph holds its English sentences, the
// French ones, then the blank before the next paragraph.

// Mirrors TTSController#createTTSNodeFilter (notably: <br> is rejected).
const ttsNodeFilter = createRejectFilter({
  tags: ['rt', 'canvas', 'br'],
  classes: ['annotationLayer'],
  attributeTokens: [],
  contents: [],
});

const ENGLISH = ['One A is here. One B is here.', 'Two A is here. Two B is here.', 'Three A.'];
const FRENCH = ['Un A est là. Un B est là.', 'Deux A est là. Deux B est là.', 'Trois A.'];

const page = (
  paragraphs: string[],
  translations: (string | null)[] = [],
  opts: { hideSource?: boolean } = {},
) => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>\n${paragraphs.map((p) => `<p>${p}</p>`).join('\n')}\n</body></html>`,
    'text/html',
  );
  doc.querySelectorAll('p').forEach((p, i) => {
    const french = translations[i];
    if (!french) return;
    if (opts.hideSource) {
      // useTextTranslation's "translation only" display empties the source text.
      for (const node of Array.from(p.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
      }
    }
    p.appendChild(
      createTranslationWrapper(doc, french, {
        lang: 'fr',
        hidden: false,
        lineBreak: false,
        blockClassName: 'translation-target-block',
      }),
    );
  });
  return new TTS(doc, ttsTextWalker, ttsNodeFilter, vi.fn(), 'sentence') as TTSCursor & {
    setMark(name: string): Range | undefined;
  };
};

const reading = (lang?: string) => (ssml: string) => spokenMarks(ssml, lang);
const place = (tts: { setMark(name: string): unknown }) => (name: string) => void tts.setMark(name);
const said = (step: TTSStep | undefined) => step?.mark.text.trim();
// What the voice then reads, sentence by sentence.
const read = (step: TTSStep | undefined, lang?: string) =>
  step ? spokenMarks(step.ssml, lang).map((m) => m.text.trim()) : [];

// The voice reports a sentence as it starts it (dispatchSpeakMark -> setMark).
const hear = (tts: { setMark(name: string): unknown }, step: TTSStep | undefined) => {
  if (step) tts.setMark(step.mark.name);
};

describe.each([
  ['the English shown', false],
  ['translation only', true],
])('sentence steps in a translated book (%s)', (_label, hideSource) => {
  const book = () => page(ENGLISH, FRENCH, { hideSource });
  const fr = reading('fr');

  it('goes back from a paragraph’s first sentence to the one before it', () => {
    const tts = book();
    tts.start();
    const p2 = stepParagraph(tts, 1, fr);
    hear(tts, p2);
    expect(said(p2)).toBe('Deux A est là.');

    const back = stepSentence(tts, -1, fr, place(tts));
    expect(said(back)).toBe('Un B est là.');
    expect(read(back, 'fr')).toEqual(['Un B est là.']);
    hear(tts, back);
    expect(said(stepSentence(tts, -1, fr, place(tts)))).toBe('Un A est là.');
    // The chapter's first sentence: the controller takes it from there.
    expect(stepSentence(tts, -1, fr, place(tts))).toBeUndefined();
  });

  it('goes on from a paragraph’s last sentence to the next paragraph, not to the blank', () => {
    const tts = book();
    const p1 = firstStep(tts, fr);
    tts.setMark(spokenMarks(p1!.ssml, 'fr')[1]!.name); // reading "Un B"
    const next = stepSentence(tts, 1, fr, place(tts));
    expect(said(next)).toBe('Deux A est là.');
    expect(read(next, 'fr')).toEqual(['Deux A est là.', 'Deux B est là.']);
  });

  it('goes to the second sentence when the first is not reported yet', () => {
    const tts = book();
    tts.start();
    tts.next(); // a new paragraph, its first sentence still loading
    expect(said(stepSentence(tts, 1, fr, place(tts)))).toBe('Deux B est là.');
  });

  it('adds up quick taps, each from where the last one landed', () => {
    const tts = book();
    const p1 = firstStep(tts, fr);
    tts.setMark(spokenMarks(p1!.ssml, 'fr')[1]!.name);
    stepSentence(tts, 1, fr, place(tts));
    expect(said(stepSentence(tts, 1, fr, place(tts)))).toBe('Deux B est là.');
    expect(said(stepSentence(tts, -1, fr, place(tts)))).toBe('Deux A est là.');
    expect(said(stepSentence(tts, -1, fr, place(tts)))).toBe('Un B est là.');
  });

  it('lands on the chapter’s last sentence, or its last paragraph', () => {
    const tts = book();
    expect(said(lastStep(tts, fr, place(tts), true))).toBe('Trois A.');
    const paragraph = lastStep(book(), fr, place(tts), false);
    expect(read(paragraph, 'fr')).toEqual(['Trois A.']);
  });
});

describe('steps in a translated book', () => {
  const fr = reading('fr');

  it('stops on a paragraph not translated yet, read from its source sentences', () => {
    const tts = page(ENGLISH, [FRENCH[0]!, null, FRENCH[2]!]);
    const p1 = firstStep(tts, fr);
    tts.setMark(spokenMarks(p1!.ssml, 'fr')[1]!.name);
    const next = stepSentence(tts, 1, fr, place(tts));
    expect(said(next)).toBe('Two A is here.');
    hear(tts, next);
    expect(said(stepSentence(tts, 1, fr, place(tts)))).toBe('Two B is here.');
    expect(said(stepParagraph(tts, 1, fr))).toBe('Trois A.');
  });

  it('steps over a paragraph with nothing to read', () => {
    const tts = page([ENGLISH[0]!, '* * *', ENGLISH[1]!], [FRENCH[0]!, null, FRENCH[1]!]);
    firstStep(tts, fr);
    expect(said(stepParagraph(tts, 1, fr))).toBe('Deux A est là.');
    expect(said(stepParagraph(tts, -1, fr))).toBe('Un A est là.');
    hear(tts, stepParagraph(tts, 1, fr));
    expect(said(stepSentence(tts, -1, fr, place(tts)))).toBe('Un B est là.');
    expect(stepParagraph(tts, -1, fr)).toBeUndefined();
  });
});

describe('sentence steps in a book read in its own language', () => {
  const en = reading();
  const make = () => page(ENGLISH);

  it('moves one sentence at a time, as foliate did', () => {
    const ours = make();
    const theirs = make();
    hear(ours, firstStep(ours, en));
    const first = theirs.start()!;
    theirs.setMark(spokenMarks(first)[0]!.name);
    for (let i = 0; i < 4; i++) {
      const a = stepSentence(ours, 1, en, place(ours));
      const b = theirs.nextMark()!;
      expect(a?.ssml).toBe(b);
    }
    for (let i = 0; i < 4; i++) {
      expect(stepSentence(ours, -1, en, place(ours))?.ssml).toBe(theirs.prevMark()!);
    }
  });

  it('knows the sentence the cursor stands on', () => {
    const tts = make();
    tts.start();
    expect(currentMarkName(tts)).toBeUndefined();
    tts.setMark('1');
    expect(currentMarkName(tts)).toBe('1');
    tts.next();
    expect(currentMarkName(tts)).toBeUndefined();
  });
});
