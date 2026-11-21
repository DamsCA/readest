import { useCallback } from 'react';
import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader, showReaderWindow } from '@/utils/nav';

export type DownloadBookHandler = (
  book: Book,
  options?: { redownload?: boolean; queued?: boolean },
) => Promise<boolean>;

/**
 * Opens a book in the reader. Shared by the bookshelf items, the
 * "Continue reading" card and the tab bar, so every way into a book takes
 * the same checks:
 * - an in-place book whose file was moved or deleted is dropped from the
 *   library instead of failing inside the reader;
 * - a cloud-only book is downloaded first;
 * - the book opens in a new window when the user asked for that.
 */
export const useOpenBook = (
  handleBookDownload: DownloadBookHandler,
  setLoading: (loading: boolean) => void,
) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateBook } = useLibraryStore();

  const makeBookAvailable = useCallback(
    async (book: Book) => {
      if (!(book.uploadedAt && !book.downloadedAt)) return true;
      if (await appService?.isBookAvailable(book)) {
        if (!book.downloadedAt || !book.coverDownloadedAt) {
          book.downloadedAt = Date.now();
          book.coverDownloadedAt = Date.now();
          await updateBook(envConfig, book);
        }
        return true;
      }
      let available = false;
      const loadingTimeout = setTimeout(() => setLoading(true), 200);
      try {
        available = await handleBookDownload(book, { queued: false });
        await updateBook(envConfig, book);
      } finally {
        clearTimeout(loadingTimeout);
        setLoading(false);
      }
      return available;
    },
    [appService, envConfig, updateBook, handleBookDownload, setLoading],
  );

  return useCallback(
    async (book: Book) => {
      // Only purely-local in-place books are probed: cloud-synced books go
      // through the on-demand download above, and hash-copy books keep their
      // Books/<hash>/ file under normal use.
      if (book.filePath && !book.uploadedAt && !book.deletedAt) {
        const available = await appService?.isBookAvailable(book);
        if (!available) {
          eventDispatcher.dispatch('toast', {
            message: _(
              'Book file no longer exists. Confirm deletion to remove it from the library.',
            ),
            type: 'info',
          });
          eventDispatcher.dispatch('delete-books', { ids: [book.hash] });
          return;
        }
      }
      if (!(await makeBookAvailable(book))) return;
      if (appService?.hasWindow && settings.openBookInNewWindow) {
        showReaderWindow(appService, [book.hash]);
      } else {
        setTimeout(() => navigateToReader(router, [book.hash]), 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService, settings.openBookInNewWindow, makeBookAvailable],
  );
};
