/**
 * Switching a PDF between page mode (the original pages) and text mode (the
 * text rebuilt as flowing chapters, see `libs/pdfText`), on the same page.
 */
import { CFI } from '@/libs/document';
import { pageAnchorId } from '@/libs/pdfText/layout';
import { pageFromTextLocation } from '@/libs/pdfText/position';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';

export { pageFromTextLocation, pdfTocItemAt } from '@/libs/pdfText/position';

/** Where to reopen the book: a page anchor in text mode, a page CFI in page mode. */
export function targetLocation(toTextMode: boolean, page: number): string {
  return toTextMode ? `#${pageAnchorId(page)}` : CFI.fake.fromIndex(page);
}

// The page to open after a switch, handed straight to the next viewer: the
// closing viewer may still save its own last position before it goes. Kept a
// few seconds rather than read once, as a viewer can mount twice in a row.
const pendingLocations = new Map<string, string>();
const PENDING_LOCATION_TTL_MS = 10_000;

export function consumePendingPdfLocation(bookKey: string): string | null {
  return pendingLocations.get(bookKey) ?? null;
}

export async function switchPdfTextMode(
  envConfig: EnvConfigType,
  bookKey: string,
  enabled: boolean,
  options: { translate?: boolean } = {},
): Promise<void> {
  const { getView, getProgress, getViewSettings, setViewSettings, recreateViewer } =
    useReaderStore.getState();
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore.getState();
  const { settings } = useSettingsStore.getState();
  const bookData = getBookData(bookKey);
  const config = getConfig(bookKey);
  const viewSettings = getViewSettings(bookKey);
  if (!bookData?.book || bookData.book.format !== 'PDF' || !config || !viewSettings) return;
  if (!!bookData.bookDoc?.isPdfText === enabled && !options.translate) return;

  // The page being read, so the other mode opens on the same spot.
  const progress = getProgress(bookKey);
  let page = 0;
  if (bookData.bookDoc?.isPdfText) {
    const view = getView(bookKey);
    const range = (view?.lastLocation?.range as Range | undefined) ?? progress?.range;
    page = pageFromTextLocation(range, bookData.bookDoc, progress?.index ?? 0);
  } else {
    page = progress?.index ?? progress?.section?.current ?? 0;
  }

  const nextViewSettings = {
    ...viewSettings,
    pdfTextMode: enabled,
    // Translation needs the text: leaving text mode turns it off.
    translationEnabled: enabled
      ? options.translate
        ? true
        : viewSettings.translationEnabled
      : false,
  };
  setViewSettings(bookKey, nextViewSettings);
  const location = targetLocation(enabled, Math.max(0, page));
  pendingLocations.set(bookKey, location);
  setTimeout(() => {
    if (pendingLocations.get(bookKey) === location) pendingLocations.delete(bookKey);
  }, PENDING_LOCATION_TTL_MS);
  const nextConfig = { ...config, viewSettings: nextViewSettings, location };
  setConfig(bookKey, { viewSettings: nextViewSettings, location });
  await saveConfig(envConfig, bookKey, nextConfig, settings);
  recreateViewer(envConfig, bookKey);
}
