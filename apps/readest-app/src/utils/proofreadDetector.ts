import type { PendingCorrection } from '@/services/ai/proofread';

// Local checks run on the page before the AI proofreads it: an English word
// list (SCOWL levels 10-70, all spellings, bundled as public/dict/en-words.txt)
// and detectors for what converting a printed book breaks. They give sure fixes
// (proposed as they are), hints (sent with the page so the AI examines every
// suspicious spot) and fallbacks (the likeliest word for a non-word nobody else
// fixed).
//
// Measured 12 Oct 2026. On pages with injected conversion errors of 15 kinds
// the AI alone found 29 of 54 (tuning pages) and 23 of 36 (fresh pages); the
// first version of these checks plus the AI's two passes found 53 and 34. On
// four real books (~9,100 paragraphs) that version proposed 466 changes, nearly
// all wrong ("Columbia" -> "Colombia", "etc" -> "etch"): a word missing from a
// list is rarely a typo. The rules are now precision first: the same books get
// 7 proposals, all real conversion errors ("lifeyou", "andthe",
// "civilization.The"); alone they still fix 42 of 54 and 28 of 36 injected
// errors and point the AI at most of the rest.

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
// Scanning confusions. "b"/"h" only within lowercase words ("tbe"): on a
// capitalised word it turned names into words ("Bart" -> "Hart").
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
];
const OCR_SUBS_LOWER: [string, string][] = [...OCR_SUBS, ['b', 'h']];
// A doubled one of these is always a slip ("the the"); other doubles can be
// meant ("had had", "it was was", "gave her her coat") and are left to the AI.
const SAFE_DOUBLES = new Set(
  'the a an to of and in on for with it he she they his at by as from but'.split(' '),
);
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const SUFFIXES = ["'s", "'", "n't", "'ll", "'re", "'ve", "'d", "'m"];
// Titles and abbreviations the word list leaves out.
const ABBREVIATIONS = new Set(
  (
    'mr mrs ms dr st jr sr mt ft capt col gen lt sgt rev prof messrs mme mlle esq ' +
    'etc vs eg ie ed eds vol pp fig ch cf al op cit ibid approx dept govt inc ltd corp ' +
    'cm mm km kg lb lbs oz'
  ).split(' '),
);
// Small words a conversion glues to a neighbour ("andthe", "beenmy", "lifeyou").
// Two glued halves are split only when one of them is such a word: two content
// words glued are usually a real compound the list lacks ("cowtown").
const FUNCTION_WORDS = new Set(
  (
    'the an and or but nor of to in on at by for with from as into onto upon than then that ' +
    'this these those there here where when what which who whom whose why how is am are was ' +
    'were been has have had do does did will would shall should can could may might must not ' +
    'no all any some each every more most much many other such only just also very too if me ' +
    'my we us our you your he him his she her it its they them their'
  ).split(' '),
);
// Prefixes that make a real word of a known one ("noncash", "reinitiate").
const PREFIXES = (
  'non un re pre counter over under out anti semi multi inter super self mis dis sub co de ' +
  'en em trans post mid micro mega ultra hyper be fore mini neo pseudo quasi tele'
).split(' ');
// Endings that make a real word of a known one ("suppressions", "kneeled"),
// with what the stem may have lost.
const ENDINGS: [string, string[]][] = [
  ['s', ['']],
  ['es', ['']],
  ['ies', ['y']],
  ['ied', ['y']],
  ['ed', ['', 'e']],
  ['d', ['']],
  ['ing', ['', 'e']],
  ['er', ['', 'e']],
  ['ers', ['', 'e']],
  ['est', ['', 'e']],
  ['ly', ['', 'le']],
  ['ily', ['y']],
  ['ally', ['', 'al']],
  ['ness', ['']],
  ['less', ['']],
  ['ful', ['']],
  ['ment', ['']],
  ['able', ['', 'e']],
  ['ability', ['', 'e', 'able']],
  ['ism', ['']],
  ['ist', ['']],
  ['ity', ['', 'e']],
  ['ize', ['', 'e']],
  ['ise', ['', 'e']],
  ['ship', ['']],
  ['hood', ['']],
  ['wise', ['']],
  ['ward', ['']],
  ['wards', ['']],
  ['ish', ['', 'e']],
  ['ive', ['', 'e']],
  ['y', ['', 'e']],
];
// Below this share of known lowercase words the page is not English: the
// checks would flag every word.
const MIN_ENGLISH_SHARE = 0.8;

const WORD_CHAR = '\\p{L}\\p{N}_';
const TOKEN = /[\p{L}\p{M}\p{N}’'■¬~�•|]+/gu;
const NAME = /(?<=[a-z,;] )(\p{Lu}\p{Ll}{2,})(?![\p{L}\p{N}_])/gu;
// "room ," (not a spaced ellipsis ". . .", a style; not "info .com", a broken
// address; ; : ! ? spaced the French way are a style too)
const SPACE_BEFORE_PUNCT = /(\p{L}+) ([,.])(?! ?\.)(?![\p{L}\p{N}])/gu;
// "end.The" (not initials: "J.R.R.Tolkien")
const MISSING_SPACE = new RegExp(
  `(?<![${WORD_CHAR}.])(\\p{L}{2,})\\.(\\p{Lu}\\p{Ll}+)(?![${WORD_CHAR}])`,
  'gu',
);
// "some- thing", a line-end hyphen left in the text
const SPLIT_HYPHEN = new RegExp(`(?<![${WORD_CHAR}])(\\p{L}+)- (\\p{Ll}+)(?![${WORD_CHAR}])`, 'gu');
// Not inside a hyphenated name or after an apostrophe ("All-That-Is Is").
const DOUBLED = new RegExp(
  `(?<![${WORD_CHAR}\\-'’])([${WORD_CHAR}]+) \\1(?![${WORD_CHAR}\\-'’])`,
  'giu',
);
const OCR_SUSPECT = /rn|vv|cl|li|ii|[015]/;
const NUMBER_LIKE = /^\d+(?:st|nd|rd|th|s|['’]s)?$/i;
const ROMAN = /^[ivxlcdm]+$/i;
// "Darby5": a footnote number glued to its word.
const FOOTNOTE = /^\p{L}{3,}\d{1,3}$/u;
const LINK = /@|:\/\/|www\.|\.(?:com|org|net|edu|gov|info|biz|io|uk|fr|de)\b|\/\w/i;

const isAlpha = (s: string) => /^\p{L}+$/u.test(s);
const isLower = (s: string) => s === s.toLowerCase() && s !== s.toUpperCase();
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
const startsUpper = (s: string) => isUpper(s.slice(0, 1));
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
 * A real word the list lacks, made of known parts: an inflection or derivation
 * ("suppressions", "kneeled", "noncash", "vibrationally") or a compound of two
 * content words ("cowtown", "endnotes"). Halves that are small function words
 * are left out: those are words a conversion glued together ("andthe").
 */
export const isDerivedWord = (word: string, words: WordLevels, depth = 0): boolean => {
  const w = word.toLowerCase();
  const knownPart = (part: string) =>
    words.has(part) || (depth === 0 && isDerivedWord(part, words, 1));
  for (const prefix of PREFIXES) {
    const rest = w.slice(prefix.length);
    if (w.startsWith(prefix) && rest.length >= 4 && !FUNCTION_WORDS.has(rest) && knownPart(rest)) {
      return true;
    }
  }
  for (const [ending, restores] of ENDINGS) {
    if (!w.endsWith(ending)) continue;
    const stem = w.slice(0, -ending.length);
    if (stem.length < 3) continue;
    // A short stem ending consonant-vowel-consonant doubles its consonant
    // before a vowel ("wit" -> "witting"): "witing" is a typo, not a word.
    const doubles =
      /^[aeiouy]/.test(ending) &&
      stem.length <= 4 &&
      /[^aeiou][aeiou][b-df-hj-np-tv-z]$/.test(stem);
    if (restores.some((r) => !(r === '' && doubles) && knownPart(stem + r))) return true;
    // "running", "stopped": a doubled final consonant.
    if (/([b-df-hj-np-tv-z])\1$/.test(stem) && words.has(stem.slice(0, -1))) return true;
  }
  for (let i = 3; i <= w.length - 3; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (FUNCTION_WORDS.has(a) || FUNCTION_WORDS.has(b)) continue;
    // Two long words glued are a conversion slip more often than a compound.
    if (a.length >= 8 && b.length >= 8) continue;
    if (words.has(a) && words.has(b)) return true;
  }
  return false;
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

/** Every spelling one scanning confusion away from `token`. */
const ocrVariants = (token: string, subs: [string, string][]): string[] => {
  const out = new Set<string>();
  for (const [src, dst] of subs) {
    for (let k = token.indexOf(src); k >= 0; k = token.indexOf(src, k + 1)) {
      out.add(token.slice(0, k) + dst + token.slice(k + src.length));
    }
  }
  return [...out];
};

/**
 * The book's names a scanning confusion away from a token ("Tbomas" ->
 * "Thomas"). Only confusions: one letter apart is just another name
 * ("Anne"/"Annie", "Davis"/"David" in the same index).
 */
const ocrNearNames = (token: string, names: Set<string>): string[] =>
  [...names].filter((name) =>
    ocrVariants(token, [...OCR_SUBS, ['b', 'h']]).some((v) => v === name),
  );

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
  // The list spells contractions with a straight apostrophe ("you're").
  const level = (w: string) => words.get(w.toLowerCase().replace(/’/g, "'")) ?? 99;
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

  // The whitespace-delimited run around a match: a web or e-mail address is
  // never proofread.
  const inLink = (a: number, b: number) => {
    while (a > 0 && !/\s/.test(paragraph[a - 1]!)) a--;
    while (b < paragraph.length && !/\s/.test(paragraph[b]!)) b++;
    return LINK.test(paragraph.slice(a, b));
  };

  for (const m of paragraph.matchAll(SPACE_BEFORE_PUNCT)) {
    if (!inLink(m.index!, m.index! + m[0].length)) fix(m[0], m[1]! + m[2]!, m.index!);
  }
  for (const m of paragraph.matchAll(MISSING_SPACE)) {
    if (inLink(m.index!, m.index! + m[0].length)) continue;
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

  // Every rule below was paid for by a wrong proposal on a real book (Never
  // Split the Difference, Think and Grow Rich, Ask and It Is Given, See You at
  // the Top): "Columbia" -> "Colombia", "Walt" -> "WaIt", "etc" -> "etch",
  // "pre-paving" -> "per-paving", "vibrationally" -> "vibration ally".
  for (const m of paragraph.matchAll(TOKEN)) {
    const tok = m[0];
    const start = m.index!;
    const end = start + tok.length;
    const core = strip(tok, `${STRAY}'’`);
    if (!core) continue;
    const at = start + tok.indexOf(core);
    // Part of a hyphenated word ("pre-paving", "co-op") or of an address.
    if (paragraph[start - 1] === '-' || paragraph[end] === '-') continue;
    if (inLink(start, end)) continue;
    if ([...tok].some((ch) => STRAY.includes(ch))) {
      const cleaned = withoutStray(tok);
      if (known(strip(cleaned, "'’"))) {
        fix(tok, cleaned, start);
        continue;
      }
    }
    if (known(core) || NUMBER_LIKE.test(core) || ROMAN.test(core)) continue;
    // Foreign words: the English list says nothing useful about them.
    if (/[^\x00-\x7F]/.test(withoutStray(core).replace(/’/g, "'"))) continue;
    // Capitals only (headings, acronyms, names), a brand ("eBay", "iPhone"),
    // a footnote number, a time ("l0:00" is a 10, not "lo"), an abbreviation
    // ("etc.", "ed."), a drop cap's remainder ("ot so very").
    if (!/\p{Ll}/u.test(core) || /\p{Ll}\p{Lu}/u.test(core)) continue;
    const letters = core.replace(/\d+$/, '');
    if (FOOTNOTE.test(core) && (known(letters) || startsUpper(letters))) continue;
    if (
      /\d/.test(core) &&
      (/^[:.,]\d/.test(paragraph.slice(end)) || /\d[:.,]$/.test(paragraph.slice(0, start)))
    ) {
      continue;
    }
    if (paragraph[end] === '.' && core.length <= 3 && !OCR_SUSPECT.test(core)) continue;
    if (start === 0 && isLower(core.slice(0, 1))) continue;
    const low = core.toLowerCase();
    if (isDerivedWord(low, words)) continue;
    // "stinkin’": a dropped g.
    if (/['’]$/.test(tok) && low.endsWith('in') && words.has(`${low}g`)) continue;

    if (startsUpper(core)) {
      // A name, almost always: only a scanning confusion is put right, toward
      // the book's own spelling, or toward a common word where a sentence
      // starts ("Tlie" -> "The"; mid-sentence, "Bear Stearns" is no "Steams").
      const bare = core.replace(/['’]s$/, '');
      if (names.has(bare) || (!OCR_SUSPECT.test(bare.toLowerCase()) && !/b/.test(bare))) continue;
      let j = start - 1;
      while (j >= 0 && /\s/.test(paragraph[j]!)) j--;
      const atStart = j < 0 || '.!?“‘"('.includes(paragraph[j]!);
      const toWords = atStart
        ? ocrVariants(bare, OCR_SUBS).filter((v) => level(v.toLowerCase()) <= 35)
        : [];
      const toNames = ocrNearNames(bare, names);
      const targets = [...new Set([...toWords, ...toNames])];
      if (targets.length === 1) fix(bare, targets[0]!, at);
      continue;
    }

    // Scanning confusions: a single substitution that gives a common word.
    const cands = ocrVariants(low, OCR_SUBS_LOWER).filter((v) => level(v) <= 50);
    if (cands.length === 1) {
      fix(core, cands[0]!, at);
      continue;
    }
    // Words run together: a single cut into two common words, one of them a
    // small function word ("andthe", "lifeyou").
    const splits: [string, string][] = [];
    for (let i = 2; i <= low.length - 2; i++) {
      const a = low.slice(0, i);
      const b = low.slice(i);
      if (known(a) && known(b)) splits.push([a, b]);
    }
    const common = splits.filter(([a, b]) => level(a) <= 35 && level(b) <= 35);
    const glued = common.filter(
      ([a, b]) => FUNCTION_WORDS.has(b) || (FUNCTION_WORDS.has(a) && !PREFIXES.includes(a)),
    );
    if (isAlpha(core) && common.length === 1 && glued.length === 1) {
      fix(core, glued[0]!.join(' '), at);
      continue;
    }
    const sugg = isAlpha(core) ? suggestions(low, words, 6) : [];
    let text = `"${core}" is not an English word`;
    if (cands.length) {
      text += ` (OCR: maybe ${cands.sort().join(' or ')})`;
    } else if (splits.length) {
      text += ` (maybe ${splits
        .slice(0, 3)
        .map((s) => s.join(' '))
        .join(' or ')})`;
    } else if (sugg.length) {
      text += ` (maybe ${sugg.slice(0, 3).join(', ')})`;
    }
    hint(text);
    // A non-word nobody else fixed is proposed only when one common word is
    // the obvious reading ("hapy" -> "happy"): a list cannot read the sentence.
    // Same first and last letters: a word the list lacks differs at its edges
    // ("ebook" -> "book", "esthetic" -> "aesthetic", "coupla" -> "couple").
    const [best, second] = [...sugg].sort((x, y) => level(x) - level(y));
    if (
      core.length >= 4 &&
      best &&
      best[0] === low[0] &&
      best.at(-1) === low.at(-1) &&
      level(best) <= 20 &&
      (!second || level(second) >= 50) &&
      !fallbacks.some((f) => f.find === core)
    ) {
      fallbacks.push({ find: core, replace: best });
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
