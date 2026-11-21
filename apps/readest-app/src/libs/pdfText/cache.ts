/**
 * Remembers the headings found in a PDF without bookmarks, so the next time
 * the book opens its table of contents is there from the first second.
 * Keyed by book and by layout version: a newer layout scans again.
 */
import type { PdfHeadingEntry } from './book';
import { PDF_TEXT_LAYOUT_VERSION } from './layout';

const keyFor = (bookHash: string) => `ouiread:pdf-headings:v${PDF_TEXT_LAYOUT_VERSION}:${bookHash}`;

const isEntry = (value: unknown): value is PdfHeadingEntry => {
  const e = value as PdfHeadingEntry;
  return (
    !!e &&
    typeof e.label === 'string' &&
    Number.isInteger(e.page) &&
    Number.isInteger(e.n) &&
    (e.level === 1 || e.level === 2 || e.level === 3)
  );
};

/** The saved headings, `[]` when the book was scanned and has none, `null` when never scanned. */
export function loadPdfHeadings(bookHash: string): PdfHeadingEntry[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(bookHash));
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isEntry) : null;
  } catch {
    return null;
  }
}

export function savePdfHeadings(bookHash: string, entries: PdfHeadingEntry[]): void {
  try {
    globalThis.localStorage?.setItem(keyFor(bookHash), JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the book is scanned again next time.
  }
}
