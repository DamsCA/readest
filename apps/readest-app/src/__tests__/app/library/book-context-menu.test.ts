import { describe, expect, it } from 'vitest';

import { getBookContextMenuItemIds } from '@/app/library/utils/libraryUtils';
import { Book } from '@/types/book';

const createBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'hash-1',
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('getBookContextMenuItemIds', () => {
  it('offers no cloud action in this edition (no Readest account)', () => {
    const ids = getBookContextMenuItemIds(createBook({ downloadedAt: 1, uploadedAt: 1 }));
    expect(ids).not.toContain('upload');
    expect(ids).not.toContain('download');
    expect(ids).not.toContain('share');
    expect(ids).toContain('delete');
  });

  it('returns a deterministic order for a local downloaded book', () => {
    const book = createBook({ downloadedAt: 1 });
    expect(getBookContextMenuItemIds(book, true)).toEqual([
      'select',
      'group',
      'markFinished',
      'markAbandoned',
      'showDetails',
      'showInFinder',
      'searchGoodreads',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('shows markUnread + markAbandoned + clearStatus for a finished book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'finished' });
    expect(getBookContextMenuItemIds(book, true)).toEqual([
      'select',
      'group',
      'markUnread',
      'markAbandoned',
      'clearStatus',
      'showDetails',
      'showInFinder',
      'searchGoodreads',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('shows "Mark as Finished" + "Clear Status" for an unread book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'unread' });
    expect(getBookContextMenuItemIds(book, true)).toEqual([
      'select',
      'group',
      'markFinished',
      'markAbandoned',
      'clearStatus',
      'showDetails',
      'showInFinder',
      'searchGoodreads',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('hides markAbandoned but offers markFinished + clearStatus for an abandoned book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'abandoned' });
    expect(getBookContextMenuItemIds(book, true)).toEqual([
      'select',
      'group',
      'markFinished',
      'clearStatus',
      'showDetails',
      'showInFinder',
      'searchGoodreads',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('offers Download (not Upload) for a cloud-only book', () => {
    const book = createBook({ uploadedAt: 1 });
    expect(getBookContextMenuItemIds(book, true)).toEqual([
      'select',
      'group',
      'markFinished',
      'markAbandoned',
      'showDetails',
      'showInFinder',
      'searchGoodreads',
      'download',
      'share',
      'delete',
    ]);
  });

  it('omits download/upload/share for a book that is neither downloaded nor uploaded', () => {
    const book = createBook({ filePath: '/some/external/file.epub' });
    expect(getBookContextMenuItemIds(book, true)).toEqual([
      'select',
      'group',
      'markFinished',
      'markAbandoned',
      'showDetails',
      'showInFinder',
      'searchGoodreads',
      'delete',
    ]);
  });

  it('produces the same order on repeated calls and never duplicates an item (issue #4389)', () => {
    const book = createBook({ downloadedAt: 1, uploadedAt: 1, readingStatus: 'finished' });
    const first = getBookContextMenuItemIds(book, true);
    const second = getBookContextMenuItemIds(book, true);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });
});
