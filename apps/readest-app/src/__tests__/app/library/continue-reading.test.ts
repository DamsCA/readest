import { describe, expect, it } from 'vitest';
import { Book } from '@/types/book';
import {
  ensureLibraryFilter,
  getContinueReadingBook,
  getReadFraction,
  isInProgress,
  matchesLibraryFilter,
} from '@/app/library/utils/continueReading';

const book = (overrides: Partial<Book>): Book =>
  ({
    hash: overrides.hash ?? 'h',
    format: 'EPUB',
    title: 'Title',
    author: 'Author',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }) as Book;

describe('getReadFraction', () => {
  it('is null without a known page count', () => {
    expect(getReadFraction(book({}))).toBeNull();
    expect(getReadFraction(book({ progress: [3, 0] }))).toBeNull();
  });

  it('is the read share, kept between 0 and 1', () => {
    expect(getReadFraction(book({ progress: [50, 200] }))).toBe(0.25);
    expect(getReadFraction(book({ progress: [250, 200] }))).toBe(1);
  });
});

describe('isInProgress', () => {
  it('needs a started, unfinished book', () => {
    expect(isInProgress(book({ progress: [10, 100] }))).toBe(true);
    expect(isInProgress(book({ progress: [0, 100] }))).toBe(false);
    expect(isInProgress(book({ progress: [100, 100] }))).toBe(false);
    expect(isInProgress(book({}))).toBe(false);
  });

  it('leaves out finished, dropped and deleted books', () => {
    expect(isInProgress(book({ progress: [10, 100], readingStatus: 'finished' }))).toBe(false);
    expect(isInProgress(book({ progress: [10, 100], readingStatus: 'abandoned' }))).toBe(false);
    expect(isInProgress(book({ progress: [10, 100], deletedAt: 1 }))).toBe(false);
  });
});

describe('getContinueReadingBook', () => {
  it('picks the book in progress that was read last', () => {
    const books = [
      book({ hash: 'old', progress: [10, 100], updatedAt: 100 }),
      book({ hash: 'done', progress: [100, 100], updatedAt: 900 }),
      book({ hash: 'recent', progress: [40, 100], updatedAt: 500 }),
      book({ hash: 'new', updatedAt: 1000 }),
    ];
    expect(getContinueReadingBook(books)?.hash).toBe('recent');
  });

  it('is null when nothing is in progress', () => {
    expect(getContinueReadingBook([book({}), book({ progress: [5, 5] })])).toBeNull();
  });
});

describe('library filters', () => {
  it('falls back to all for unknown values', () => {
    expect(ensureLibraryFilter('pdf')).toBe('pdf');
    expect(ensureLibraryFilter('nope')).toBe('all');
    expect(ensureLibraryFilter(null)).toBe('all');
  });

  it('matches by format or progress', () => {
    const pdf = book({ format: 'PDF' });
    const reading = book({ progress: [2, 10] });
    expect(matchesLibraryFilter(pdf, 'pdf')).toBe(true);
    expect(matchesLibraryFilter(pdf, 'epub')).toBe(false);
    expect(matchesLibraryFilter(reading, 'reading')).toBe(true);
    expect(matchesLibraryFilter(pdf, 'reading')).toBe(false);
    expect(matchesLibraryFilter(pdf, 'all')).toBe(true);
  });
});
