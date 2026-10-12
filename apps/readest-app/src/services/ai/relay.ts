import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

// The Cloudflare relay of relay/fish-audio. Besides the Fish voice it serves
// the AI translation (/v1/translate) and the AI proofreading (/v1/proofread),
// both on Workers AI's free daily allocation.

export const getRelayUrl = () =>
  (process.env['NEXT_PUBLIC_FISH_RELAY_URL'] || '').replace(/\/+$/, '');
// Sent as X-Relay-Token. It ships inside the public APK: it only screens out
// scanners; the relay's per-IP limit is what protects the account.
export const getRelayToken = () => process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] || '';

// Workers AI resets its free allocation at 00:00 UTC. Translation and
// proofreading share it, so once the relay reports it used up, both stop
// asking until then instead of paying a failed round trip each time.
let pausedUntil = 0;
export const nextUtcMidnight = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
export const isAIPaused = () => Date.now() < pausedUntil;
export const pauseAIUntilMidnight = () => {
  pausedUntil = nextUtcMidnight(Date.now());
};
/** Test hook: forget a paused allocation. */
export const resetAIPause = () => {
  pausedUntil = 0;
};

/** The relay's answer to a refused request: pauses the AI when the day's allocation is gone. */
export const relayError = async (response: Response, what: string): Promise<Error> => {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (response.status === 429 && /allocation/i.test(data?.error || '')) pauseAIUntilMidnight();
  return new Error(`${what} failed (${response.status}): ${data?.error || ''}`);
};

export const postToRelay = async (
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> => {
  const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(`${getRelayUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Token': getRelayToken() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};
