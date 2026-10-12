import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  WordLevels,
  checkPage,
  collectNames,
  combineCorrections,
  detectParagraph,
  isKnownWord,
  parseWordList,
} from '@/utils/proofreadDetector';

// The bundled list itself: the checks are only as good as their dictionary.
let words: WordLevels;
beforeAll(() => {
  words = parseWordList(readFileSync(resolve(process.cwd(), 'public/dict/en-words.txt'), 'utf8'));
});

const names = new Set(['Thomas', 'Martha']);
const fixesOf = (text: string) => detectParagraph(text, words, names).fixes;

describe('parseWordList', () => {
  it('reads the level headers', () => {
    const list = parseWordList('#10\nthe\ncat\n#70\nzymurgy\ncat\n');
    expect([...list]).toEqual([
      ['the', 10],
      ['cat', 10],
      ['zymurgy', 70],
    ]);
  });

  it('bundles the whole SCOWL list', () => {
    expect(words.size).toBeGreaterThan(110_000);
    expect(words.get('the')).toBe(10);
  });
});

describe('isKnownWord', () => {
  it('knows every English spelling, contractions, accents and ligatures', () => {
    for (const w of ['colour', 'color', 'whilst', 'grey', 'don’t', "dogs'", 'naïve', 'ﬁnd', 'Mr']) {
      expect(isKnownWord(w, words), w).toBe(true);
    }
    expect(isKnownWord('rnorning', words)).toBe(false);
  });
});

describe('detectParagraph', () => {
  it('fixes scanning confusions that leave a single word', () => {
    expect(fixesOf('A thin rnist hung over the old mill vvheel, in al1 her life.')).toEqual([
      { find: 'rnist', replace: 'mist' },
      { find: 'vvheel', replace: 'wheel' },
      { find: 'al1', replace: 'all' },
    ]);
  });

  it('fixes mechanical slips: spacing, line-end hyphens, doubled small words', () => {
    expect(fixesOf('He sat in the room , waiting for the end.The door opened.')).toEqual([
      { find: 'room ,', replace: 'room,' },
      { find: 'end.The', replace: 'end. The' },
    ]);
    expect(fixesOf('It was some- thing she heard over the the noise.')).toEqual([
      { find: 'some- thing', replace: 'something' },
      { find: 'the the', replace: 'the' },
    ]);
  });

  it('splits words run together, swaps transposed letters, strips stray marks', () => {
    expect(fixesOf('Why wasthe tide out when teh sun rose over the wo■rd?')).toEqual([
      { find: 'wasthe', replace: 'was the' },
      { find: 'teh', replace: 'the' },
      { find: 'wo■rd', replace: 'word' },
    ]);
  });

  it("puts a misread name right from the book's own spelling", () => {
    expect(fixesOf('Tbomas looked at the sea while Martha waited.')).toEqual([
      { find: 'Tbomas', replace: 'Thomas' },
    ]);
  });

  it('leaves names, numbers, acronyms, foreign words and styles alone', () => {
    for (const text of [
      'Thomas said that Elspeth’s dog barked at Martha.',
      'In the 1920s, on the 3rd of May, the BBC met a naïve señor at the café.',
      'And then . . . nothing. And then ... silence.',
      'Whilst the colour was grey, she ain’t sure.',
    ]) {
      expect(detectParagraph(text, words, names), text).toEqual({
        fixes: [],
        hints: [],
        fallbacks: [],
      });
    }
  });

  it('points doubtful spots out to the AI instead of deciding', () => {
    const found = detectParagraph(
      'She had had enough, and a strange blorvik made her hapy.',
      words,
      names,
    );
    expect(found.fixes).toEqual([]);
    expect(found.hints).toContain('"had had": doubled word');
    expect(found.hints).toContain('"blorvik" is not an English word');
    expect(found.hints.find((h) => h.startsWith('"hapy"'))).toMatch(/maybe happy/);
    // A lowercase non-word nobody fixes falls back to its likeliest word.
    expect(found.fallbacks).toEqual([{ find: 'hapy', replace: 'happy' }]);
  });
});

describe('collectNames', () => {
  it('keeps unknown capitalised words seen mid-sentence at least twice', () => {
    const found = collectNames(
      [
        'Then he saw Martha again, and later Martha came; he met Tbomas once.',
        'He told Elspeth that Elspeth was right. The end.',
      ],
      words,
    );
    expect([...found].sort()).toEqual(['Elspeth', 'Martha']);
  });
});

describe('checkPage', () => {
  it('stays silent on a page in another language', () => {
    const page = [
      'Il était une fois une petite maison dans la forêt, où vivait une vieille femme avec son chat.',
    ];
    expect(checkPage(page, words, names)).toEqual([{ fixes: [], hints: [], fallbacks: [] }]);
  });
});

describe('combineCorrections', () => {
  it('orders sure fixes, then the AI, then fallbacks, without two fixes on one spot', () => {
    const texts = ['The rnorning was cold and the brigde was icy.', 'Fine text here.'];
    const local = [
      {
        fixes: [{ find: 'rnorning', replace: 'morning' }],
        hints: [],
        fallbacks: [
          { find: 'brigde', replace: 'bridge' },
          { find: 'icy', replace: 'ice' },
        ],
      },
    ];
    const ai = [
      // Overlaps the sure fix: dropped.
      { p: 0, find: 'The rnorning was', replace: 'The morning was' },
      // Covers the fallback's word: the AI's version wins.
      { p: 0, find: 'the brigde', replace: 'the bridge' },
      { p: 1, find: 'Fine text', replace: 'Fine texts' },
    ];
    expect(combineCorrections(texts, local, ai)).toEqual([
      [
        { find: 'rnorning', replace: 'morning' },
        { find: 'the brigde', replace: 'the bridge' },
        { find: 'icy', replace: 'ice' },
      ],
      [{ find: 'Fine text', replace: 'Fine texts' }],
    ]);
  });
});
