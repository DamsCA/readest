import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { switchPdfTextMode } from '../utils/pdfTextMode';

/**
 * A PDF in page mode cannot be translated: its pages are drawings. When
 * translation is turned on (toolbar button, language panel...), reopen the
 * PDF in text mode on the same page; the translation then runs as in an EPUB.
 */
export const usePdfTranslationSwitch = (bookKey: string) => {
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const switching = useRef(false);

  const isPdfPageMode = bookData?.book?.format === 'PDF' && !!bookData?.isFixedLayout;
  const translationEnabled = !!viewSettings?.translationEnabled;

  useEffect(() => {
    if (!isPdfPageMode || !translationEnabled || switching.current) return;
    switching.current = true;
    switchPdfTextMode(envConfig, bookKey, true, { translate: true }).catch((e) => {
      console.error('Could not switch the PDF to text mode', e);
      switching.current = false;
    });
  }, [isPdfPageMode, translationEnabled, envConfig, bookKey]);
};
