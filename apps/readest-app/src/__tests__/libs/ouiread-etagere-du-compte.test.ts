import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';

const settings = {
  lastSyncedAtBooks: 0,
  lastSyncedAtConfigs: 0,
  lastSyncedAtNotes: 0,
};
const setSettings = vi.fn();
const saveSettings = vi.fn(async () => {});
const setLibrary = vi.fn();

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings, setSettings, saveSettings }) },
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ setLibrary }) },
}));

import { prendreEtagere, viderEtagere } from '@/libs/ouiread/etagereDuCompte';

const livre = (hash: string, extra: Partial<Book> = {}) =>
  ({ hash, title: hash, format: 'EPUB', createdAt: 1, updatedAt: 1, ...extra }) as Book;

const service = (library: Book[]) => {
  const deleteBook = vi.fn(async () => {});
  const saveLibraryBooks = vi.fn(async () => {});
  const appService = {
    loadLibraryBooks: vi.fn(async () => library),
    deleteBook,
    saveLibraryBooks,
  } as unknown as AppService;
  return { appService, deleteBook, saveLibraryBooks };
};
const env = {} as EnvConfigType;

// An in-memory browser storage (the test environment's own has no clear()).
const memoire = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, String(v)),
  removeItem: (k: string) => void memoire.delete(k),
  clear: () => memoire.clear(),
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  settings.lastSyncedAtBooks = 1_790_000_000_000;
  settings.lastSyncedAtConfigs = 1_790_000_000_000;
  settings.lastSyncedAtNotes = 1_790_000_000_000;
});

describe('one shelf per account on a browser', () => {
  it('a first account on this browser keeps the shelf (a visitor’s own books)', async () => {
    const { appService, deleteBook } = service([livre('a')]);
    expect(await prendreEtagere('compte-1', appService, env)).toBe(false);
    expect(deleteBook).not.toHaveBeenCalled();
    expect(localStorage.getItem('lel-etagere-de')).toBe('compte-1');
    expect(settings.lastSyncedAtBooks).toBe(1_790_000_000_000);
  });

  it('the same account again changes nothing', async () => {
    localStorage.setItem('lel-etagere-de', 'compte-1');
    const { appService, deleteBook } = service([livre('a', { uploadedAt: 5 })]);
    expect(await prendreEtagere('compte-1', appService, env)).toBe(false);
    expect(deleteBook).not.toHaveBeenCalled();
  });

  it('another account takes the old shelf off and starts from zero', async () => {
    localStorage.setItem('lel-etagere-de', 'compte-1');
    const enLigne = livre('kevin', { uploadedAt: 5 });
    const seulementIci = livre('perso');
    const { appService, deleteBook, saveLibraryBooks } = service([enLigne, seulementIci]);

    expect(await prendreEtagere('compte-2', appService, env)).toBe(true);

    expect(deleteBook).toHaveBeenCalledTimes(1);
    expect(deleteBook).toHaveBeenCalledWith(enLigne, 'purge');
    expect(saveLibraryBooks).toHaveBeenCalledWith([seulementIci]);
    expect(setLibrary).toHaveBeenCalledWith([seulementIci]);
    expect(settings.lastSyncedAtBooks).toBe(0);
    expect(settings.lastSyncedAtConfigs).toBe(0);
    expect(settings.lastSyncedAtNotes).toBe(0);
    expect(saveSettings).toHaveBeenCalled();
    expect(localStorage.getItem('lel-etagere-de')).toBe('compte-2');
  });

  it('signing out takes the shelf off and forgets its account', async () => {
    localStorage.setItem('lel-etagere-de', 'compte-1');
    const { appService, saveLibraryBooks } = service([
      livre('ca-marche', { uploadedAt: 5 }),
      livre('efface', { uploadedAt: 5, deletedAt: 9 }),
    ]);
    await viderEtagere(appService, env);
    expect(saveLibraryBooks).toHaveBeenCalledWith([]);
    expect(settings.lastSyncedAtBooks).toBe(0);
    expect(localStorage.getItem('lel-etagere-de')).toBeNull();
    // The next account is then a first account here: nothing more to clear.
    const suivant = service([]);
    expect(await prendreEtagere('compte-2', suivant.appService, env)).toBe(false);
  });
});
