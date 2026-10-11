import { describe, it, expect, vi } from 'vitest';
import { TTS } from 'foliate-js/tts.js';
import { createRejectFilter } from '@/utils/node';
import { ttsTextWalker } from '@/utils/ttsTextWalker';
import { filterSSMLWithLang, parseSSMLMarks, prefetchSentenceTexts } from '@/utils/ssml';
import { createTranslationWrapper } from '@/utils/translationDom';

// Page-follow in translation mode. The reader turns the page to the START of
// the range that foliate associates with the spoken mark (TTSController
// dispatchSpeakMark -> view.tts.setMark -> renderer.scrollToAnchor). For a
// French sentence, that range must therefore START in the French text: if it
// starts in the English paragraph above, the view stays on the English page
// while the voice reads the French on the next page.

// Mirrors TTSController#createTTSNodeFilter (notably: <br> is rejected).
const ttsNodeFilter = createRejectFilter({
  tags: ['rt', 'canvas', 'br'],
  classes: [
    'annotationLayer',
    'epubtype-footnote',
    'duokan-footnote-content',
    'duokan-footnote-item',
  ],
  attributeTokens: [
    { tag: 'aside', attribute: 'epub:type', tokens: ['footnote', 'endnote', 'note', 'rearnote'] },
  ],
  contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
});

const FRENCH = 'Le jour touchait à sa fin. Il rentra chez lui.';

// A paragraph as the reader leaves it once the translation is injected.
// `sourceHtml` is the EPUB's own paragraph content: commercial EPUBs usually
// end it right on the closing punctuation, with no trailing whitespace.
const translatedParagraph = (
  sourceHtml: string,
  opts: { lineBreak?: boolean; hideSource?: boolean } = {},
) => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body><p>${sourceHtml}</p></body></html>`,
    'text/html',
  );
  const p = doc.querySelector('p')!;
  if (opts.hideSource) {
    // useTextTranslation's "translation only" display empties the source text.
    for (const node of Array.from(p.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
    }
  }
  p.appendChild(
    createTranslationWrapper(doc, FRENCH, {
      lang: 'fr',
      hidden: false,
      lineBreak: !!opts.lineBreak,
      blockClassName: 'translation-target-block',
    }),
  );
  return doc;
};

// What TTSController does for one paragraph in translation mode, up to the
// point where the page-follow target is known.
const speakFirstFrenchSentence = (doc: Document) => {
  const tts = new TTS(doc, ttsTextWalker, ttsNodeFilter, vi.fn(), 'sentence');
  const ssml = tts.start()!;
  const { marks } = parseSSMLMarks(filterSSMLWithLang(ssml, 'fr', 'en'), 'en');
  const first = marks[0]!;
  const range = tts.setMark(first.name) as Range | undefined;
  return { marks, first, followed: range?.toString() ?? '(no range)' };
};

describe('TTS page-follow in translation mode', () => {
  it('follows the French sentence, not the English one glued before it', () => {
    const { first, followed } = speakFirstFrenchSentence(
      translatedParagraph('It was the end of the day.'),
    );
    expect(first.text.trimStart().startsWith('Le jour')).toBe(true);
    // The page must be turned to where the voice is.
    expect(followed.trimStart().startsWith('Le jour')).toBe(true);
    expect(followed).not.toContain('It was the end');
  });

  it('follows the French sentence with the line-break display option', () => {
    const { followed } = speakFirstFrenchSentence(
      translatedParagraph('It was the end of the day.', { lineBreak: true }),
    );
    expect(followed.trimStart().startsWith('Le jour')).toBe(true);
  });

  it('follows the French sentence when the English ends inside an inline tag', () => {
    const { followed } = speakFirstFrenchSentence(
      translatedParagraph('It was the end of <em>the day.</em>'),
    );
    expect(followed.trimStart().startsWith('Le jour')).toBe(true);
  });

  it('follows the French sentence even when a space separates the languages', () => {
    // A trailing space is not enough: foliate's abbreviation rule rejoins a
    // segment ending in a 1-3 letter word plus a period ("day.") to the next.
    const { followed } = speakFirstFrenchSentence(
      translatedParagraph('He said nothing more that day. '),
    );
    expect(followed.trimStart().startsWith('Le jour')).toBe(true);
    expect(followed).not.toContain('that day');
  });

  it('follows the French sentence in "translation only" display', () => {
    const { followed } = speakFirstFrenchSentence(
      translatedParagraph('It was the end of the day.', { hideSource: true }),
    );
    expect(followed.trimStart().startsWith('Le jour')).toBe(true);
  });

  it('keeps every French sentence as its own mark, spoken exactly as banked', () => {
    // Audio is cached by exact sentence text: the spoken marks must stay
    // byte-identical to what the prefetcher generates from the translation.
    const { marks } = speakFirstFrenchSentence(translatedParagraph('It was the end of the day.'));
    expect(marks.map((m) => m.text)).toEqual(prefetchSentenceTexts(FRENCH, 'fr'));
  });
});

describe('ttsTextWalker outside translation mode', () => {
  // It replaces foliate's textWalker for EVERY book, so a paragraph without a
  // translation must produce exactly the SSML and mark ranges it always did.
  it('matches foliate textWalker byte for byte on untranslated text', async () => {
    const { textWalker } = await import('foliate-js/text-walker.js');
    const body =
      '<p>Mr. Smith arrived at noon. He was <em>very</em> tired, wasn’t he? ' +
      'Yes. “Rest now,” she said.</p><p>Second paragraph; short. End of it.</p>';
    const make = () =>
      new DOMParser().parseFromString(
        `<!DOCTYPE html><html lang="en"><body>${body}</body></html>`,
        'text/html',
      );
    for (const granularity of ['sentence', 'word'] as const) {
      const a = new TTS(make(), textWalker, ttsNodeFilter, vi.fn(), granularity);
      const b = new TTS(make(), ttsTextWalker, ttsNodeFilter, vi.fn(), granularity);
      for (let ssmlA = a.start(), ssmlB = b.start(); ssmlA || ssmlB; ) {
        expect(ssmlB).toBe(ssmlA);
        const { marks } = parseSSMLMarks(ssmlA!, 'en');
        for (const m of marks) {
          expect(b.setMark(m.name)?.toString()).toBe(a.setMark(m.name)?.toString());
        }
        ssmlA = a.next();
        ssmlB = b.next();
      }
    }
  });
});
