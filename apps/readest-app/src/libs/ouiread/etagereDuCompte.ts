import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

// One shelf per account on a browser (owner's report, 27 Nov 2026: he signed
// out of his account on his phone, signed in with another Google account, and
// the new account showed the old one's books and never got its welcome books).
//
// Readest keeps the local shelf and the sync dates when someone signs out, so
// the next account to sign in on the same browser took the old shelf as its
// own: the old books stayed on screen, recent ones were pushed into the new
// account, and its first pull asked only for changes since the old account's
// last sync, so the server never gave the welcome books (api/sync.ts gives
// them on a first pull, since < 1000, of an empty library).
//
// Now the shelf leaves the device when its account signs out, and again if
// another account signs in while it is still there. The books stay in the
// account online and come back at its next sign-in.

/** Remembered in the browser: the account whose books are on this shelf. */
const CLE_PROPRIETAIRE = 'lel-etagere-de';

const lireProprietaire = () => {
  try {
    return localStorage.getItem(CLE_PROPRIETAIRE);
  } catch {
    return null;
  }
};

const noterProprietaire = (userId: string | null) => {
  try {
    if (userId) localStorage.setItem(CLE_PROPRIETAIRE, userId);
    else localStorage.removeItem(CLE_PROPRIETAIRE);
  } catch {}
};

/**
 * Takes the shelf off this browser: the books kept online (their file, cover,
 * reading progress and notes), the shelf itself and the sync dates, so the
 * next sign-in starts from the account's own library. A book that is only on
 * this device (never uploaded) stays, so that no one loses their only copy.
 */
export const viderEtagere = async (appService: AppService, envConfig: EnvConfigType) => {
  const library = await appService.loadLibraryBooks();
  const gardes: Book[] = [];
  for (const book of library) {
    if (!book.uploadedAt || book.deletedAt) {
      if (!book.deletedAt) gardes.push(book);
      continue;
    }
    try {
      await appService.deleteBook(book, 'purge');
    } catch (error) {
      console.warn('Shelf: could not remove a book from this device', error);
    }
  }
  await appService.saveLibraryBooks(gardes);
  useLibraryStore.getState().setLibrary(gardes);

  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  settings.lastSyncedAtBooks = 0;
  settings.lastSyncedAtConfigs = 0;
  settings.lastSyncedAtNotes = 0;
  setSettings(settings);
  await saveSettings(envConfig, settings);
  noterProprietaire(null);
};

/**
 * Before an account's first sync on this browser: the shelf becomes its own.
 * Empty, or a visitor's books (no account yet): they are kept and become this
 * account's. Another account's shelf: taken off first. Returns true when it
 * was taken off (the first pull then starts from zero).
 */
export const prendreEtagere = async (
  userId: string,
  appService: AppService,
  envConfig: EnvConfigType,
): Promise<boolean> => {
  const proprietaire = lireProprietaire();
  if (proprietaire === userId) return false;
  if (proprietaire === null) {
    noterProprietaire(userId);
    return false;
  }
  await viderEtagere(appService, envConfig);
  noterProprietaire(userId);
  return true;
};
