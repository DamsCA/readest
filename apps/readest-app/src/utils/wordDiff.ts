// What a proposed correction changes, word by word, so the reader can judge it
// at a glance: the bar used to show only the struck original, cut off, with the
// replacement out of sight (reported 15 Oct 2026, "how am I supposed to know
// whether it is useful?").

export interface DiffPart {
  kind: 'same' | 'del' | 'add';
  text: string;
}

/** Word-level difference (longest common subsequence) between two short texts. */
export const wordDiff = (before: string, after: string): DiffPart[] => {
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], word: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += ` ${word}`;
    else parts.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push('del', a[i++]!);
    } else {
      push('add', b[j++]!);
    }
  }
  while (i < a.length) push('del', a[i++]!);
  while (j < b.length) push('add', b[j++]!);
  return parts;
};

export type CorrectionKind = 'added' | 'removed' | 'spelling' | 'spacing' | 'changed';

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** The kind of change, named for the reader. */
export const correctionKind = (before: string, after: string): CorrectionKind => {
  if (letters(before) === letters(after)) return 'spacing';
  const parts = wordDiff(before, after);
  const dels = parts.filter((p) => p.kind === 'del');
  const adds = parts.filter((p) => p.kind === 'add');
  if (!dels.length && adds.length) return 'added';
  if (dels.length && !adds.length) return 'removed';
  const oneWord = (p?: DiffPart) => !!p && !p.text.includes(' ');
  if (dels.length === 1 && adds.length === 1 && oneWord(dels[0]) && oneWord(adds[0])) {
    return 'spelling';
  }
  return 'changed';
};

/**
 * A few words of the paragraph on each side of an excerpt, to read it in its
 * sentence; `cutBefore` / `cutAfter` say whether the paragraph goes on.
 */
export const contextAround = (
  paragraph: string,
  excerpt: string,
  words = 5,
): { before: string; after: string; cutBefore: boolean; cutAfter: boolean } => {
  const text = paragraph.replace(/\s+/g, ' ');
  const find = excerpt.replace(/\s+/g, ' ').trim();
  const at = find ? text.indexOf(find) : -1;
  if (at < 0) return { before: '', after: '', cutBefore: false, cutAfter: false };
  const head = text.slice(0, at).trim().split(' ').filter(Boolean);
  const tail = text
    .slice(at + find.length)
    .trim()
    .split(' ')
    .filter(Boolean);
  return {
    before: head.slice(-words).join(' '),
    after: tail.slice(0, words).join(' '),
    cutBefore: head.length > words,
    cutAfter: tail.length > words,
  };
};
