import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { TranslationProvider } from '../types';
import { googleProvider } from './google';

// Natural (idiomatic) translation by a language model, through the same
// Cloudflare relay as the Fish voice (relay/fish-audio, route /v1/translate:
// Workers AI, Mistral Small 3.1, free daily allocation). Machine translators
// render idioms word for word; measured on 12 Oct 2026 with the same inputs:
//   "It's raining cats and dogs"  Google: "Il pleut comme des chats et des chiens"
//                                 AI:     "Il pleut des cordes"
//   "have your cake and eat it"   Google: "avoir le gâteau et le manger"
//                                 AI:     "vouloir le beurre et l'argent du beurre"
// at 5-9 Workers AI neurons per paragraph (10,000 free per day) and 1-2 s each.
//
// Never leaves a paragraph untranslated: whatever the AI could not translate
// (daily allocation used up, relay unreachable, a refusal) goes to Google.

const getRelayUrl = () => (process.env['NEXT_PUBLIC_FISH_RELAY_URL'] || '').replace(/\/+$/, '');
// Sent as X-Relay-Token. It ships inside the public APK: it only screens out
// scanners; the relay's per-IP limit is what protects the account.
const getRelayToken = () => process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] || '';

// The reader translates up to 5 paragraphs at once; a chapter prefetch can hand
// over many more in one call.
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;
// Titles, numbers and labels go to Google: there is no idiom to render in two
// words, and a short text reads like a writing prompt to a language model — in
// the 12 Oct 2026 test the title "The Call" came back as a whole invented page.
const MIN_WORDS_FOR_AI = 4;
const wordCount = (text: string) => text.trim().split(/\s+/).length;

// Workers AI resets its free allocation at 00:00 UTC. Once the relay reports
// it used up, skip the AI until then instead of paying a failed round trip per
// paragraph before falling back.
let pausedUntil = 0;
const nextUtcMidnight = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

const translateOne = async (text: string, sourceLang: string, targetLang: string) => {
  if (Date.now() < pausedUntil) throw new Error('AI translation paused until 00:00 UTC');
  const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const response = await fetchFn(`${getRelayUrl()}/v1/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Token': getRelayToken() },
      body: JSON.stringify({ text, source: sourceLang, target: targetLang }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 429 && /allocation/i.test(data?.error || '')) {
        pausedUntil = nextUtcMidnight(Date.now());
      }
      throw new Error(`AI translation failed (${response.status}): ${data?.error || ''}`);
    }
    const data = (await response.json()) as { translation?: unknown };
    const translation = typeof data.translation === 'string' ? data.translation.trim() : '';
    if (!translation) throw new Error('AI translation came back empty');
    return translation;
  } finally {
    clearTimeout(timer);
  }
};

// The same paragraph is often asked for twice at once (the viewport observer
// and the page-turn pass both find it untranslated before either result is
// cached): 10 AI requests for 5 paragraphs in the 12 Oct 2026 test, which
// halves the free daily allocation. Concurrent asks share one request.
const inFlight = new Map<string, Promise<string>>();
const translateShared = (text: string, sourceLang: string, targetLang: string) => {
  const key = `${sourceLang}\u0000${targetLang}\u0000${text}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = translateOne(text, sourceLang, targetLang);
    inFlight.set(key, pending);
    const forget = () => inFlight.delete(key);
    pending.then(forget, forget);
  }
  return pending;
};

export const aiProvider: TranslationProvider = {
  name: 'ai',
  label: _('AI (natural)'),
  // Needs the relay; builds without it never offer this provider.
  disabled: !getRelayUrl(),
  translate: async (texts: string[], sourceLang: string, targetLang: string) => {
    const results: string[] = texts.map(() => '');
    const viaGoogle: number[] = [];
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        const text = texts[i]!;
        if (!text?.trim()) {
          results[i] = text;
          continue;
        }
        if (wordCount(text) < MIN_WORDS_FOR_AI) {
          viaGoogle.push(i);
          continue;
        }
        try {
          results[i] = await translateShared(text, sourceLang, targetLang);
        } catch (err) {
          console.warn('AI translation failed, using Google for this paragraph:', err);
          viaGoogle.push(i);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
    if (viaGoogle.length) {
      const fallback = await googleProvider.translate(
        viaGoogle.map((i) => texts[i]!),
        sourceLang,
        targetLang,
      );
      viaGoogle.forEach((i, j) => {
        results[i] = fallback[j] ?? '';
      });
    }
    return results;
  },
};

/** Test hook: forget a paused allocation. */
export const resetAITranslationPause = () => {
  pausedUntil = 0;
};
