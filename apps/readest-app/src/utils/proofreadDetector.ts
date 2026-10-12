import type { PendingCorrection } from '@/services/ai/proofread';

// Local checks run on the page before the AI proofreads it: an English word
// list (SCOWL levels 10-70, all spellings, bundled as public/dict/en-words.txt)
// and detectors for what converting a printed book breaks. They give sure fixes
// (proposed as they are), hints (sent with the page so the AI examines every
// suspicious spot) and fallbacks (the likeliest word for a non-word nobody else
// fixed).
//
// Measured 12 Oct 2026 on pages with injected conversion errors of 15 kinds:
// the AI alone found 29 of 54 (tuning pages) and 23 of 36 (fresh pages); with
// these checks and the AI's second pass for missing words, 53 of 54 and 34 of
// 36, with at most one false alert. A Python prototype was measured; this is
// its port.

/** Word -> SCOWL level (10 = most common, 70 = rare). */
export type WordLevels = Map<string, number>;

export interface LocalFindings {
  fixes: PendingCorrection[];
  hints: string[];
  fallbacks: PendingCorrection[];
}

const DICT_URL = '/dict/en-words.txt';
let dictPromise: Promise<WordLevels> | null = null;

/** Lines "#N" open the words of level N. */
export const parseWordList = (text: string): WordLevels => {
  const words: WordLevels = new Map();
  let level = 70;
  for (const line of text.split('\n')) {
    const word = line.trim();
    if (!word) continue;
    if (word[0] === '#') {
      level = Number(word.slice(1)) || 70;
    } else if (!words.has(word)) {
      words.set(word, level);
    }
  }
  return words;
};

/** The bundled list, loaded once (1.1 MB, about 115,000 words). */
export const loadEnglishWords = (): Promise<WordLevels> => {
  dictPromise ??= fetch(DICT_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`word list: HTTP ${response.status}`);
      return response.text();
    })
    .then(parseWordList)
    .catch((err) => {
      dictPromise = null;
      throw err;
    });
  return dictPromise;
};

const STRAY = '■¬~�•|';
const OCR_SUBS: [string, string][] = [
  ['rn', 'm'],
  ['vv', 'w'],
  ['cl', 'd'],
  ['li', 'h'],
  ['1', 'l'],
  ['0', 'o'],
  ['5', 's'],
  ['ii', 'u'],
  ['ni', 'm'],
  ['I', 'l'],
  ['l', 'I'],
  ['1', 'I'],
];
// A doubled one of these is always a slip ("the the"); other doubles can be
// meant ("had had", "that that") and are left to the AI.
const SAFE_DOUBLES = new Set(
  'the a an to of and in on for with was is it he she they her his at by as from but'.split(' '),
);
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const SUFFIXES = ["'s", "'", "n't", "'ll", "'re", "'ve", "'d", "'m"];
// Titles the word list leaves out.
const ABBREVIATIONS = new Set(
  'mr mrs ms dr st jr sr mt ft capt col gen lt sgt rev prof messrs mme mlle esq'.split(' '),
);
// Below this share of known lowercase words the page is not English: the
// checks would flag every word.
const MIN_ENGLISH_SHARE = 0.8;

const WORD_CHAR = '\\p{L}\\p{N}_';
const TOKEN = /[\p{L}\p{M}\p{N}’'■¬~�•|]+/gu;
const NAME = /(?<=[a-z,;] )(\p{Lu}\p{Ll}{2,})(?![\p{L}\p{N}_])/gu;
// "room ," (a spaced ellipsis ". . ." is a style, not a slip)
const SPACE_BEFORE_PUNCT = /(\p{L}+) ([,.;:!?])(?! ?\.)/gu;
// "end.The"
const MISSING_SPACE = new RegExp(
  `(?<![${WORD_CHAR}])(\\p{L}+)\\.(\\p{Lu}\\p{Ll}+)(?![${WORD_CHAR}])`,
  'gu',
);
// "some- thing", a line-end hyphen left in the text
const SPLIT_HYPHEN = new RegExp(`(?<![${WORD_CHAR}])(\\p{L}+)- (\\p{Ll}+)(?![${WORD_CHAR}])`, 'gu');
const DOUBLED = new RegExp(`(?<![${WORD_CHAR}])([${WORD_CHAR}]+) \\1(?![${WORD_CHAR}])`, 'giu');
const OCR_SUSPECT = /rn|vv|cl|li|[01]/;
const NUMBER_LIKE = /^\d+(?:st|nd|rd|th|s|['’]s)?$/i;

const isAlpha = (s: string) => /^\p{L}+$/u.test(s);
const isLower = (s: string) => s === s.toLowerCase() && s !== s.toUpperCase();
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
const startsUpper = (s: string) => isUpper(s.slice(0, 1));
const keepCase = (src: string, dst: string) =>
  startsUpper(src) ? dst.slice(0, 1).toUpperCase() + dst.slice(1) : dst;
const strip = (s: string, chars: string) => {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a]!)) a++;
  while (b > a && chars.includes(s[b - 1]!)) b--;
  return s.slice(a, b);
};
const withoutStray = (s: string) => [...s].filter((ch) => !STRAY.includes(ch)).join('');
// "naïve", "ﬁnd": accents and ligatures the list spells otherwise.
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '');

export const isKnownWord = (word: string, words: WordLevels): boolean => {
  const w = word.toLowerCase().replace(/’/g, "'");
  if (words.has(w) || ABBREVIATIONS.has(w)) return true;
  if (SUFFIXES.some((suf) => w.endsWith(suf) && words.has(w.slice(0, -suf.length)))) return true;
  const folded = fold(w);
  return folded !== w && isKnownWord(folded, words);
};

/**
 * Capitalised words seen mid-sentence at least twice that no dictionary knows:
 * the book's characters and places.
 */
export const collectNames = (texts: string[], words: WordLevels, minCount = 2): Set<string> => {
  const seen = new Map<string, number>();
  for (const text of texts) {
    for (const m of text.matchAll(NAME)) {
      const name = m[1]!;
      if (!isKnownWord(name, words)) seen.set(name, (seen.get(name) ?? 0) + 1);
    }
  }
  return new Set([...seen].filter(([, n]) => n >= minCount).map(([name]) => name));
};

const dropOne = (s: string) => Array.from(s, (_, i) => s.slice(0, i) + s.slice(i + 1));

/** The book's names one edit (or one scanning confusion) away from a token. */
const nearNames = (token: string, names: Set<string>): string[] => {
  const out = new Set<string>();
  const low = token.toLowerCase();
  for (const name of names) {
    const n = name.toLowerCase();
    if (Math.abs(n.length - low.length) > 2) continue;
    for (const [src, dst] of OCR_SUBS) {
      if (low.includes(src) && low.replace(src, dst) === n) out.add(name);
    }
    if (n.length === low.length && [...n].filter((ch, i) => ch !== low[i]).length === 1) {
      out.add(name);
    }
    if (n.length === low.length + 1 && dropOne(n).includes(low)) out.add(name);
    if (n.length + 1 === low.length && dropOne(low).includes(n)) out.add(name);
  }
  return [...out].sort();
};

/**
 * Words one edit from `w`, likeliest first: two letters swapped, then a letter
 * lost, then the rest; among equals, the most common word.
 */
const suggestions = (w: string, words: WordLevels, limit = 3): string[] => {
  const found = new Map<string, number>();
  const add = (c: string, rank: number) => {
    if (c !== w && words.has(c)) found.set(c, Math.min(found.get(c) ?? 9, rank));
  };
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (b.length > 1) add(a + b[1] + b[0] + b.slice(2), 0);
    for (const c of LETTERS) {
      add(a + c + b, 1);
      if (b) add(a + c + b.slice(1), 2);
    }
    if (b) add(a + b.slice(1), 3);
  }
  return [...found.keys()]
    .sort(
      (x, y) =>
        found.get(x)! - found.get(y)! ||
        words.get(x)! - words.get(y)! ||
        (x < y ? -1 : x > y ? 1 : 0),
    )
    .slice(0, limit);
};

/** Sure fixes, hints for the AI and fallbacks for one paragraph's text. */
export const detectParagraph = (
  paragraph: string,
  words: WordLevels,
  names: Set<string> = new Set(),
): LocalFindings => {
  const fixes: PendingCorrection[] = [];
  const hints: string[] = [];
  const fallbacks: PendingCorrection[] = [];
  const spans: [number, number][] = [];
  const known = (w: string) => isKnownWord(w, words);
  const level = (w: string) => words.get(w) ?? 99;
  const hint = (h: string) => {
    if (!hints.includes(h)) hints.push(h);
  };
  // A rule replaces every occurrence in the book: one fix per text is enough.
  const fix = (find: string, replace: string, at: number) => {
    if (find === replace || fixes.some((f) => f.find === find)) return;
    if (spans.some(([a, b]) => at < b && a < at + find.length)) return;
    spans.push([at, at + find.length]);
    fixes.push({ find, replace });
  };

  for (const m of paragraph.matchAll(SPACE_BEFORE_PUNCT)) {
    fix(m[0], m[1]! + m[2]!, m.index!);
  }
  for (const m of paragraph.matchAll(MISSING_SPACE)) {
    if (known(m[1]!) && known(m[2]!)) fix(m[0], `${m[1]}. ${m[2]}`, m.index!);
  }
  for (const m of paragraph.matchAll(SPLIT_HYPHEN)) {
    const joined = m[1]! + m[2]!;
    if (known(joined)) fix(m[0], joined, m.index!);
    else hint(`"${m[0]}": a word split by a line-end hyphen?`);
  }
  for (const m of paragraph.matchAll(DOUBLED)) {
    if (SAFE_DOUBLES.has(m[1]!.toLowerCase())) fix(m[0], m[1]!, m.index!);
    else hint(`"${m[0]}": doubled word`);
  }

  for (const m of paragraph.matchAll(TOKEN)) {
    const tok = m[0];
    let j = m.index! - 1;
    while (j >= 0 && /\s/.test(paragraph[j]!)) j--;
    const atStart = j < 0 || '.!?“‘"('.includes(paragraph[j]!);
    const core = strip(tok, `${STRAY}'’`);
    if (!core) continue;
    const at = m.index! + tok.indexOf(core);
    if ([...tok].some((ch) => STRAY.includes(ch))) {
      const cleaned = withoutStray(tok);
      if (known(strip(cleaned, "'’"))) {
        fix(tok, cleaned, m.index!);
        continue;
      }
    }
    if (known(core) || NUMBER_LIKE.test(core)) continue;
    // Foreign words: the English list says nothing useful about them.
    if (/[^\x00-\x7F]/.test(withoutStray(core).replace(/’/g, "'"))) continue;
    const bare = core.replace(/['’]s$/, '');
    if (names.has(core) || names.has(bare)) continue;
    if (startsUpper(core) && !atStart && isAlpha(bare) && !OCR_SUSPECT.test(bare)) continue; // a name
    if (isUpper(core) && core.length <= 4) continue; // an acronym

    // Scanning confusions: a single substitution that gives a word.
    const cands = new Set<string>();
    for (const [src, dst] of OCR_SUBS) {
      for (let k = core.indexOf(src); k >= 0; k = core.indexOf(src, k + 1)) {
        const cand = core.slice(0, k) + dst + core.slice(k + src.length);
        if (known(cand)) cands.add(cand);
      }
    }
    if (cands.size === 1) {
      fix(core, keepCase(core, [...cands][0]!), at);
      continue;
    }
    // Words run together: a single cut into two common words.
    const low = core.toLowerCase();
    const splits: [string, string][] = [];
    for (let i = 1; i < low.length; i++) {
      const a = low.slice(0, i);
      const b = low.slice(i);
      if (!known(a) || !known(b)) continue;
      if ((a.length > 1 || 'ai'.includes(a)) && (b.length > 1 || 'ai'.includes(b))) {
        splits.push([a, b]);
      }
    }
    const common = splits.filter(([a, b]) => level(a) <= 35 && level(b) <= 35);
    if (isAlpha(core) && isLower(core) && common.length === 1) {
      fix(core, common[0]!.join(' '), at);
      continue;
    }
    if (isAlpha(core)) {
      const swaps = new Set<string>();
      for (let i = 0; i < low.length - 1; i++) {
        const c = low.slice(0, i) + low[i + 1] + low[i] + low.slice(i + 2);
        if (c !== low && words.has(c)) swaps.add(c);
      }
      if (swaps.size === 1) {
        fix(core, keepCase(core, [...swaps][0]!), at);
        continue;
      }
    }
    const sugg = isAlpha(core) ? suggestions(low, words) : [];
    const close = startsUpper(core) ? nearNames(core, names) : [];
    if (close.length === 1) {
      fix(core, close[0]!, at);
      continue;
    }
    let text = `"${core}" is not an English word`;
    if (startsUpper(core)) {
      text += close.length ? ` (maybe ${close.join(' or ')})` : ' (maybe a name)';
    } else if (cands.size) {
      text += ` (OCR: maybe ${[...cands].sort().join(' or ')})`;
    } else if (splits.length) {
      text += ` (maybe ${splits
        .slice(0, 3)
        .map((s) => s.join(' '))
        .join(' or ')})`;
    } else if (sugg.length) {
      text += ` (maybe ${sugg.map((s) => keepCase(core, s)).join(', ')})`;
    }
    hint(text);
    // A lowercase non-word that neither the AI nor a sure fix handles is
    // proposed with its likeliest replacement.
    if (isLower(core) && (sugg.length || splits.length)) {
      const best = common.length
        ? common[0]!.join(' ')
        : sugg.length
          ? sugg[0]!
          : splits[0]!.join(' ');
      if (!fallbacks.some((f) => f.find === core)) fallbacks.push({ find: core, replace: best });
    }
  }
  return { fixes, hints, fallbacks };
};

const NO_FINDINGS: LocalFindings = { fixes: [], hints: [], fallbacks: [] };

/** Share of the page's lowercase words the English list knows. */
export const englishShare = (texts: string[], words: WordLevels): number => {
  let total = 0;
  let hits = 0;
  for (const text of texts) {
    for (const m of text.matchAll(TOKEN)) {
      const w = strip(m[0], `${STRAY}'’`);
      if (w.length < 2 || !isAlpha(w) || !isLower(w)) continue;
      total++;
      if (isKnownWord(w, words)) hits++;
    }
  }
  return total ? hits / total : 1;
};

/** Local findings for each paragraph of a page; none when the page is not English. */
export const checkPage = (
  texts: string[],
  words: WordLevels,
  names: Set<string>,
): LocalFindings[] =>
  englishShare(texts, words) < MIN_ENGLISH_SHARE
    ? texts.map(() => NO_FINDINGS)
    : texts.map((text) => detectParagraph(text, words, names));

/**
 * One list per paragraph: sure fixes first, then the AI's corrections, then
 * fallbacks for non-words nothing covered. A correction touching a spot
 * already corrected is dropped (two fixes of one word would fight).
 */
export const combineCorrections = (
  texts: string[],
  local: LocalFindings[],
  ai: { p: number; find: string; replace: string }[],
): PendingCorrection[][] =>
  texts.map((text, p) => {
    const out: PendingCorrection[] = [];
    const spans: [number, number][] = [];
    const add = ({ find, replace }: PendingCorrection) => {
      const at = find ? text.indexOf(find) : -1;
      if (at < 0 || find === replace || out.some((c) => c.find === find)) return;
      if (spans.some(([a, b]) => at < b && a < at + find.length)) return;
      spans.push([at, at + find.length]);
      out.push({ find, replace });
    };
    local[p]?.fixes.forEach(add);
    ai.filter((c) => c.p === p).forEach(add);
    for (const fallback of local[p]?.fallbacks ?? []) {
      if (!out.some((c) => c.find.includes(fallback.find))) add(fallback);
    }
    return out;
  });
