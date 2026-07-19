import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore, flushPendingLibrarySave } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { debounce } from '@/utils/debounce';

export const useProgressAutoSave = (bookKey: string) => {
  const { envConfig } = useEnv();
  const getConfig = useBookDataStore((s) => s.getConfig);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  // Reactive subscription so the effect below fires the debounced save
  // whenever this book's progress changes. Reads from readerProgressStore.
  const progress = useBookProgress(bookKey);

  // Tracks the location we last persisted (or, before the first save, the
  // location loaded from disk at book open). We skip saveConfig when the
  // in-memory location matches — saveConfig unconditionally bumps
  // config.updatedAt, and a bump on the initial relocate makes the local
  // record look newer than a fresher server-side push, so the next sync
  // overwrites the server's progress with the stale local one (issue #4222).
  const lastSavedLocationRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // The real persistence step: eagerly writes the per-book config.json (the
  // source of truth for the EXACT reading spot). Awaitable and idempotent —
  // returns immediately when the location hasn't moved since the last save, so
  // it's safe to call from the debounce, on unmount, and on app-background.
  // Kept in a ref so the (stable) debounced wrapper and the lifecycle listeners
  // always run the latest closure without being recreated.
  const persistRef = useRef<() => Promise<void>>(async () => {});
  persistRef.current = async () => {
    // Skip while previewing a deep-link target — the user's actual
    // last-read position should not be overwritten by a transient view.
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    const config = getConfig(bookKey);
    if (!config) return;
    // setProgress writes config.location synchronously on every relocate, so
    // by the time a progress change reaches us this is already up to date.
    const currentLocation = config.location ?? null;
    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSavedLocationRef.current = currentLocation;
      return;
    }
    if (currentLocation === lastSavedLocationRef.current) return;
    const settings = useSettingsStore.getState().settings;
    await saveConfig(envConfig, bookKey, config, settings);
    lastSavedLocationRef.current = currentLocation;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookConfig = useCallback(
    debounce(() => {
      void persistRef.current();
    }, 1000),
    [],
  );

  useEffect(() => {
    // Snapshot the loaded-from-disk location before any progress events fire,
    // so we don't treat the initial relocate as a user-driven change.
    if (!initializedRef.current) {
      const config = getConfig(bookKey);
      if (config) {
        initializedRef.current = true;
        lastSavedLocationRef.current = config.location ?? null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    saveBookConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, bookKey]);

  // Force-flush the exact reading position the instant the app is backgrounded
  // or the book is closed. On Android the WebView is frozen/killed on background
  // WITHOUT unmounting React, and closing the book within the ~1s debounce
  // window used to drop the last move entirely — the per-book config.json was
  // never rewritten, so reopening landed on a stale position. visibilitychange
  // (hidden) is the reliable pre-freeze hook on mobile; pagehide + the unmount
  // cleanup cover web reloads and in-app navigation.
  useEffect(() => {
    const flushNow = () => {
      saveBookConfig.cancel();
      void persistRef.current();
      void flushPendingLibrarySave();
    };
    const onVisibility = () => {
      if (document.hidden) flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      // Book closed / navigated away: persist the final position + roll up the
      // throttled library.json write.
      flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveBookConfig]);
};
