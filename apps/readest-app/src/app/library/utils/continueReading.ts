import { Book } from '@/types/book';

/** Shelf filters shown as chips above the books (`?filter=` in the URL). */
export const LIBRARY_FILTERS = ['all', 'reading', 'epub', 'pdf'] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

export const ensureLibraryFilter = (value: string | null | undefined): LibraryFilter =>
  (LIBRARY_FILTERS as readonly string[]).includes(value || '') ? (value as LibraryFilter) : 'all';

/** Share of the book already read, from 0 to 1, or null when it is unknown. */
export const getReadFraction = (book: Book): number | null => {
  const [current, total] = book.progress ?? [0, 0];
  if (!total || total <= 0) return null;
  return Math.min(1, Math.max(0, current / total));
};

/** A book the reader has started and not finished nor dropped. */
export const isInProgress = (book: Book): boolean => {
  if (book.deletedAt) return false;
  if (book.readingStatus === 'finished' || book.readingStatus === 'abandoned') return false;
  const fraction = getReadFraction(book);
  return fraction !== null && fraction > 0 && fraction < 1;
};

/** The book to offer first: the one in progress that was read most recently. */
export const getContinueReadingBook = (books: Book[]): Book | null => {
  let latest: Book | null = null;
  for (const book of books) {
    if (!isInProgress(book)) continue;
    if (!latest || book.updatedAt > latest.updatedAt) latest = book;
  }
  return latest;
};

export const matchesLibraryFilter = (book: Book, filter: LibraryFilter): boolean => {
  switch (filter) {
    case 'reading':
      return isInProgress(book);
    case 'epub':
      return book.format === 'EPUB';
    case 'pdf':
      return book.format === 'PDF';
    default:
      return true;
  }
};
