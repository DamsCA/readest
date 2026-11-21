/**
 * "Listen" from the library: the book opens, then the voice starts on its own.
 * The library leaves the book's hash here; the reader takes it once the page
 * is on screen. Session storage, so a forgotten request dies with the tab.
 */
const LISTEN_ON_OPEN_KEY = 'listenOnOpen';

export const requestListenOnOpen = (bookHash: string) => {
  try {
    sessionStorage.setItem(LISTEN_ON_OPEN_KEY, bookHash);
  } catch {
    // Storage refused (private mode): the book still opens, just silent.
  }
};

/** True once for the book that was asked to speak, then forgets the request. */
export const consumeListenOnOpen = (bookHash: string | undefined): boolean => {
  if (!bookHash) return false;
  try {
    if (sessionStorage.getItem(LISTEN_ON_OPEN_KEY) !== bookHash) return false;
    sessionStorage.removeItem(LISTEN_ON_OPEN_KEY);
    return true;
  } catch {
    return false;
  }
};
