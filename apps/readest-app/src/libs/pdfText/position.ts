/**
 * Where the reader is, in a PDF read in text mode: which original page, which
 * table of contents entry. Pure DOM functions, no store, so they can be tested.
 */
import type { BookDoc, TOCItem } from '@/libs/document';

/** PDF page (0-based) at the start of the current text-mode screen. */
export function pageFromTextLocation(
  range: Range | null | undefined,
  bookDoc: BookDoc,
  sectionIndex: number,
): number {
  const sectionStart = bookDoc.pdfSectionStarts?.[sectionIndex] ?? 0;
  const doc = range?.startContainer?.ownerDocument;
  if (!range || !doc) return sectionStart;
  let page = sectionStart;
  for (const anchor of Array.from(doc.querySelectorAll<HTMLElement>('.pdf-page'))) {
    try {
      // -1: the anchor sits before the screen, 0: on it. Keep the last of those.
      if (range.comparePoint(anchor, 0) <= 0) page = Number(anchor.dataset['page']) - 1;
      else break;
    } catch {
      break;
    }
  }
  return Number.isFinite(page) && page >= 0 ? page : sectionStart;
}

/** [page, n-th heading] of a text-mode anchor id; a page anchor sorts before its headings. */
const positionOf = (fragment: string | null | undefined): [number, number] | null => {
  if (!fragment) return null;
  const heading = /^pdf-h-(\d+)-(\d+)$/.exec(fragment);
  if (heading) return [Number(heading[1]), Number(heading[2])];
  const page = /^pdf-page-(\d+)$/.exec(fragment);
  return page ? [Number(page[1]), -1] : null;
};

const notAfter = (a: [number, number], b: [number, number]) =>
  a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);

/**
 * The table of contents entry of the screen being read, for a PDF in text
 * mode whose table of contents was built after the book opened (foliate only
 * knows the entries present at opening).
 */
export function pdfTocItemAt(
  bookDoc: BookDoc,
  range: Range | null | undefined,
  sectionIndex: number,
): TOCItem | undefined {
  const items: TOCItem[] = [];
  const walk = (list?: TOCItem[]) =>
    list?.forEach((item) => {
      items.push(item);
      walk(item.subitems);
    });
  walk(bookDoc.toc);
  if (!items.length) return undefined;

  // Where the screen starts: after the last heading above it, else at the section's first page.
  let here: [number, number] = [bookDoc.pdfSectionStarts?.[sectionIndex] ?? 0, -1];
  const doc = range?.startContainer?.ownerDocument;
  if (range && doc) {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[id^="pdf-h-"]'))) {
      try {
        if (range.comparePoint(el, 0) <= 0) here = positionOf(el.id) ?? here;
        else break;
      } catch {
        break;
      }
    }
  }
  let found: TOCItem | undefined;
  for (const item of items) {
    const position = positionOf(item.href.split('#')[1]);
    if (position && notAfter(position, here)) found = item;
  }
  return found;
}
