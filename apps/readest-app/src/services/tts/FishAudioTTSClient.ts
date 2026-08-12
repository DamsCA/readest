import { getUserLocale } from '@/utils/misc';
import { isSameLang } from '@/utils/lang';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { getAPIBaseUrl, isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';

// Fish Audio's most advanced model, currently free for developers
// (s2.1-pro-free, $0.00 / M UTF-8 bytes — no API credit required).
const FISH_AUDIO_TTS_URL = 'https://api.fish.audio/v1/tts';
const FISH_AUDIO_MODEL = 's2.1-pro-free';
// Max number of synthesized-sentence object URLs kept in memory (LRU-evicted).
// Must exceed peak concurrency so the sentence being played can't be evicted,
// and hold enough banked-ahead audio to ride out gaps: the paragraph pipeline
// plus deep preloads plus played history (~10-25MB of blobs at 128).
const FISH_AUDIO_CACHE_MAX = 128;

// Default reading voice: "Claire" — soft / deep / intimate / breathy / gentle.
// Chosen by the user as a warm, sensual, hypnotic French narration voice.
const FISH_AUDIO_VOICES: TTSVoice[] = [
  {
    id: 'da05ae30d8c0428eb47498df524e448c',
    name: 'Claire (Fish Audio)',
    lang: 'fr-FR',
  },
];
const FISH_AUDIO_DEFAULT_VOICE_ID = FISH_AUDIO_VOICES[0]!.id;

const getApiKey = () => process.env['NEXT_PUBLIC_FISHAUDIO_API_KEY'] || '';

// URL of the self-hosted Claire server running on the user's own GPU (WSL2),
// e.g. "http://192.168.0.130:8880". When set, it is the primary (free) engine;
// Fish Audio is only used as a fallback while its free tier lasts.
const getClaireServerUrl = () =>
  (process.env['NEXT_PUBLIC_CLAIRE_SERVER_URL'] || '').replace(/\/+$/, '');

// Public read-only URL of the Cloudflare R2 bucket where the Claire server
// banks every generated MP3 (e.g. "https://pub-xxxx.r2.dev"). Checked first:
// if a sentence was ever generated (on any device, by anyone), its audio is
// here — playable with the PC off, offline-friendly, cross-device.
const getClaireR2Url = () => (process.env['NEXT_PUBLIC_CLAIRE_R2_URL'] || '').replace(/\/+$/, '');

// Shared secret sent to the Claire server so only this app can generate through
// the public tunnel (a stranger with the URL is rejected).
const getClaireToken = () => process.env['NEXT_PUBLIC_CLAIRE_TOKEN'] || '';

// The PC's address can change (DHCP, or a fresh Cloudflare quick-tunnel URL on
// each restart). Rather than bake a fixed address, the server publishes its
// current URL to R2 at "server-url.txt"; the app discovers it there. Cached
// briefly so we don't refetch on every sentence.
let _discoveredServerUrl = '';
let _discoveredServerAt = 0;
// Short TTL so a fresh tunnel URL (the server publishes a new one to R2 each
// time it restarts) is picked up quickly instead of failing for minutes.
const SERVER_URL_TTL_MS = 60 * 1000;

// In-flight discovery, shared by every concurrent caller. The TTL guard below
// only caches NON-empty results, so before the first success — or after a 5xx
// clears the cache — every #fetchAudio refetched server-url.txt, 3-5 at a time
// (the LOOKAHEAD pipeline), none of them bounded.
let _discoveryInFlight: Promise<string> | null = null;

const resolveClaireServerUrl = async (
  tauriFetch: typeof fetch | null,
  signal?: AbortSignal,
): Promise<string> => {
  const baked = getClaireServerUrl();
  if (baked) return baked;
  const r2 = getClaireR2Url();
  if (!r2) return '';
  const now = Date.now();
  if (_discoveredServerUrl && now - _discoveredServerAt < SERVER_URL_TTL_MS) {
    return _discoveredServerUrl;
  }
  if (_discoveryInFlight) return _discoveryInFlight;

  _discoveryInFlight = (async () => {
    // Bounded by hand rather than AbortSignal.any/AbortSignal.timeout: this runs
    // in the device's System WebView on Android, which can predate both. A hung
    // R2 used to hang playback indefinitely — this await sits in front of every
    // audio request.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const onAbort = () => ctrl.abort();
    if (signal?.aborted) ctrl.abort();
    else signal?.addEventListener('abort', onAbort);
    try {
      const url = `${r2}/server-url.txt`;
      const opts = { method: 'GET', signal: ctrl.signal } as RequestInit;
      const resp = tauriFetch ? await tauriFetch(url, opts) : await fetch(url, opts);
      if (resp.ok) {
        const discovered = (await resp.text()).trim().replace(/\/+$/, '');
        if (/^https?:\/\//.test(discovered)) {
          _discoveredServerUrl = discovered;
          _discoveredServerAt = Date.now();
          return discovered;
        }
      }
    } catch {
      // Discovery failed — fall back to whatever we last knew (may be empty).
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    return _discoveredServerUrl;
  })().finally(() => {
    _discoveryInFlight = null;
  });

  return _discoveryInFlight;
};

// Persistent, cross-session audio cache ("generate once, keep forever"): a
// sentence synthesized while the PC is on is stored on-device via the Cache
// API, so re-reading it later plays instantly and works fully offline / with
// the PC off. Only brand-new, never-read text needs the server.
const PERSIST_CACHE_NAME = 'claire-tts-audio-v1';

const hashText = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  // Include length to further reduce the already-tiny collision chance.
  return `${h.toString(16)}-${s.length.toString(16)}`;
};

const persistRequest = (voiceId: string, text: string) =>
  new Request(`https://claire-tts.local/${encodeURIComponent(voiceId)}/${hashText(text)}`);

// Memoize the Cache API handle: caches.open() per read/write costs ~5-20ms on
// Android WebView, paid on every persisted sentence.
let _persistCachePromise: Promise<Cache> | null = null;
const openPersistCache = (): Promise<Cache> | null => {
  if (typeof caches === 'undefined') return null;
  if (!_persistCachePromise) _persistCachePromise = caches.open(PERSIST_CACHE_NAME);
  return _persistCachePromise;
};

// Sanity-check a buffer before caching/persisting it: a tunnel reset can hand
// us a truncated 200 body, and persisting garbage makes that exact sentence
// fail on EVERY future read (a deterministic, permanent skip).
const isValidAudio = (buffer: ArrayBuffer): boolean => {
  if (buffer.byteLength < 1024) return false;
  const b = new Uint8Array(buffer, 0, 4);
  const isRiff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46; // 'RIFF'
  const isId3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33; // 'ID3'
  const isMpegFrame = b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
  return isRiff || isId3 || isMpegFrame;
};

const persistedAudioExists = async (voiceId: string, text: string): Promise<boolean> => {
  const cacheP = openPersistCache();
  if (!cacheP) return false;
  try {
    const cache = await cacheP;
    return !!(await cache.match(persistRequest(voiceId, text)));
  } catch {
    return false;
  }
};

const readPersistedAudio = async (
  voiceId: string,
  text: string,
): Promise<{ buffer: ArrayBuffer; type: string } | null> => {
  const cacheP = openPersistCache();
  if (!cacheP) return null;
  try {
    const cache = await cacheP;
    const res = await cache.match(persistRequest(voiceId, text));
    if (!res) return null;
    const buffer = await res.arrayBuffer();
    if (!isValidAudio(buffer)) {
      // Corrupt entry (partial body persisted by an older build): purge it so
      // the sentence regenerates instead of failing forever.
      await cache.delete(persistRequest(voiceId, text)).catch(() => {});
      return null;
    }
    return { buffer, type: res.headers.get('Content-Type') || 'audio/mpeg' };
  } catch {
    return null;
  }
};

const writePersistedAudio = async (
  voiceId: string,
  text: string,
  buffer: ArrayBuffer,
  type: string,
): Promise<void> => {
  const cacheP = openPersistCache();
  if (!cacheP) return;
  try {
    const cache = await cacheP;
    await cache.put(
      persistRequest(voiceId, text),
      new Response(buffer, { headers: { 'Content-Type': type } }),
    );
  } catch {
    // Storage unavailable/full — degrade to in-memory only, don't break playback.
  }
};

const deletePersistedAudio = async (voiceId: string, text: string): Promise<void> => {
  const cacheP = openPersistCache();
  if (!cacheP) return;
  try {
    const cache = await cacheP;
    await cache.delete(persistRequest(voiceId, text));
  } catch {
    // Best-effort.
  }
};

// Fish Audio's REST API does not send CORS headers, so a direct browser fetch
// is blocked. We therefore use two transports:
//  - Tauri (desktop/Android): the native HTTP plugin, which is not subject to
//    the webview's CORS policy, calling api.fish.audio directly with the key
//    embedded at build time (personal app).
//  - Web: a same-origin proxy route (/api/fishaudio/tts) that injects the key
//    server-side, hiding it from the client and avoiding CORS entirely.
export class FishAudioTTSClient implements TTSClient {
  name = 'fish-audio';
  initialized = false;
  controller?: TTSController;
  appService?: AppService | null;

  // COPY, never the module array by reference: getAllVoices() mutates
  // voice.disabled = !this.initialized on these objects. Shared, a dying
  // controller's shutdown (initialized = false) stamped Claire as disabled on
  // the very objects the NEW book's controller was already holding — setVoice
  // then missed Fish, fell through to Edge/Native/Web, and persisted that as the
  // GLOBAL preferred client. That is why Claire was replaced by a robotic voice
  // on book switch, and why it stayed broken across restarts.
  #voices: TTSVoice[] = FISH_AUDIO_VOICES.map((v) => ({ ...v }));
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = FISH_AUDIO_DEFAULT_VOICE_ID;
  #rate = 1.0;

  // Double-buffered playback: two elements alternate so the NEXT sentence is
  // already decoded and starts inside the previous one's 'ended' handler —
  // killing the ~100-300ms per-sentence gap of a single-element src swap.
  #audioA: HTMLAudioElement | null = null;
  #audioB: HTMLAudioElement | null = null;
  #audioElement: HTMLAudioElement | null = null; // the CURRENTLY-playing one
  #isPlaying = false;
  // User pressed pause. Distinct from #isPlaying: a pause can land while a
  // sentence is still being SYNTHESIZED, i.e. before any audio exists.
  #paused = false;
  // Synthetic word-boundary tracking (karaoke highlight): paced from
  // audio.currentTime against char-weighted word fractions of the sentence.
  // After several consecutive R2 misses, skip the R2 probe for LOW-priority
  // preloads (cold books pay a wasted RTT per sentence otherwise). Highs keep
  // probing, and any hit re-arms probing for everyone.
  #r2ConsecMisses = 0;
  // Small cache of synthesized audio object URLs keyed by `${voiceId}:${text}`,
  // populated by preload so playback can start without a round-trip.
  #audioCache = new Map<string, string>();
  // In-flight requests keyed by cacheKey, so the same sentence is never
  // generated twice concurrently (e.g. playback catching up to a preload).
  #inFlight = new Map<string, { promise: Promise<string>; priority: 'high' | 'low' }>();

  // "Minutes d'avance" indicator: sentences banked ahead of the playhead by
  // low-priority preloads (idle bank-ahead during a pause, playback lookahead),
  // keyed by cacheKey -> character count. Keying by the FINAL synthesized text
  // means banking (low) and playback (high) converge on the same key, so a
  // sentence added when banked is removed when played — correct even in
  // translation mode (both sides see the French text). Summed and converted to
  // an estimated listen time that the TTS bar shows so the banking is visible.
  #bankedAhead = new Map<string, number>();
  #bankedNotifyTimer: ReturnType<typeof setTimeout> | null = null;

  #noteBanked(key: string, chars: number) {
    if (this.#bankedAhead.has(key)) return;
    // Bound memory: a deep pause bank could otherwise grow unbounded. Drop the
    // oldest (closest-behind) entry — over-count after a seek self-corrects.
    if (this.#bankedAhead.size >= 512) {
      const oldest = this.#bankedAhead.keys().next().value;
      if (oldest !== undefined) this.#bankedAhead.delete(oldest);
    }
    this.#bankedAhead.set(key, chars);
    this.#scheduleBankedNotify();
  }

  #noteConsumed(key: string) {
    if (this.#bankedAhead.delete(key)) this.#scheduleBankedNotify();
  }

  #emitBankedNow() {
    let chars = 0;
    for (const c of this.#bankedAhead.values()) chars += c;
    // ~14 chars/sec of speech at rate 1.0 (FR/EN average); scale by rate.
    const minutes = chars / (14 * (this.#rate || 1)) / 60;
    this.controller?.dispatchEvent(new CustomEvent('tts-banked-ahead', { detail: { minutes } }));
  }

  #scheduleBankedNotify() {
    if (this.#bankedNotifyTimer) return;
    this.#bankedNotifyTimer = setTimeout(() => {
      this.#bankedNotifyTimer = null;
      this.#emitBankedNow();
    }, 700);
  }

  // Re-emit the current banked-ahead value immediately, so a control panel that
  // opens mid-pause shows the runway right away instead of waiting for the next
  // bank/consume tick.
  emitBankedAhead() {
    this.#emitBankedNow();
  }

  constructor(controller?: TTSController, appService?: AppService | null) {
    this.controller = controller;
    this.appService = appService;
  }

  async init() {
    // Available when the self-hosted Claire server is configured, when a Fish
    // key is baked into the build (Tauri), or on the web platform (proxy route).
    this.initialized =
      !!getClaireR2Url() || !!getClaireServerUrl() || !!getApiKey() || isWebAppPlatform();
    return this.initialized;
  }

  #cacheKey(voiceId: string, text: string) {
    return `${voiceId}:${text}`;
  }

  async #synthesize(
    voiceId: string,
    text: string,
    signal: AbortSignal,
    priority: 'high' | 'low' = 'high',
  ): Promise<string> {
    const cacheKey = this.#cacheKey(voiceId, text);
    const cached = this.#audioCache.get(cacheKey);
    if (cached) {
      // Refresh LRU recency: a sentence prefetched early would otherwise sit at
      // the oldest position and be the first evicted right when it's played.
      this.#audioCache.delete(cacheKey);
      this.#audioCache.set(cacheKey, cached);
      return cached;
    }

    // Coalesce concurrent requests for the same sentence so it is generated
    // once. Exception: a high-priority (playback) request never waits on an
    // in-flight low-priority (preload) one — it fires its own so it can jump
    // the GPU queue; the stray preload copy just finishes and gets cached.
    const inflight = this.#inFlight.get(cacheKey);
    if (inflight && !(priority === 'high' && inflight.priority === 'low')) {
      try {
        return await inflight.promise;
      } catch {
        // Shared request failed/aborted — fall through and run our own.
      }
    }

    const task = (async () => {
      // Low-priority preloads are BANKING passes: when the audio is already
      // persisted on-device there is nothing to do — materializing a blob URL
      // here churned the LRU and evicted about-to-play audio on deep preloads.
      if (priority === 'low' && (await persistedAudioExists(voiceId, text))) {
        return '';
      }

      // 1) Persistent on-device cache: audio generated in a previous session.
      //    This is the "PC off / offline" path — no server needed.
      const persisted = await readPersistedAudio(voiceId, text);
      if (persisted) {
        return this.#storeInMemory(cacheKey, persisted.buffer, persisted.type);
      }

      // 2) Generate (Claire server preferred, Fish Audio fallback), then persist
      //    forever so it never has to be generated again. Validate first: a
      //    truncated tunnel body persisted as-is would make this sentence fail
      //    on every future read.
      const { buffer, type } = await this.#fetchAudio(voiceId, text, signal, priority);
      if (!isValidAudio(buffer)) throw new Error('Invalid audio data received.');
      await writePersistedAudio(voiceId, text, buffer, type);
      if (priority === 'low') return ''; // banked — no blob needed until playback nears
      return this.#storeInMemory(cacheKey, buffer, type);
    })();

    const entry = { promise: task, priority };
    this.#inFlight.set(cacheKey, entry);
    try {
      return await task;
    } finally {
      // Only clear if still ours (a later high-priority call may have replaced it).
      if (this.#inFlight.get(cacheKey) === entry) this.#inFlight.delete(cacheKey);
    }
  }

  async #fetchAudio(
    voiceId: string,
    text: string,
    signal: AbortSignal,
    priority: 'high' | 'low' = 'high',
  ): Promise<{ buffer: ArrayBuffer; type: string }> {
    let response: Response;
    const isTauri = isTauriAppPlatform();
    const tauriFetch = isTauri ? (await import('@tauri-apps/plugin-http')).fetch : null;
    const doFetch = tauriFetch ?? fetch;
    const serverUrl = await resolveClaireServerUrl(tauriFetch, signal);

    // Combine the caller's signal with a hard timeout: a wedged tunnel
    // otherwise hangs the await forever and playback stalls mid-paragraph.
    // Set when OUR deadline fired (as opposed to a transport error or the
    // caller aborting), so the retry loop can tell the two apart.
    let deadlineFired = false;
    const fetchWithTimeout = async (url: string, opts: RequestInit, timeoutMs: number) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => {
        deadlineFired = true;
        ctrl.abort();
      }, timeoutMs);
      const onAbort = () => ctrl.abort();
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onAbort);
      try {
        return await doFetch(url, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    };

    // 0) Cloud (R2), BANKING ONLY. If this sentence was ever generated its MP3
    //    is in R2 (key = the Claire server's r2_key(text)), so a low-priority
    //    pass can fetch it instead of asking the GPU — and whatever it finds
    //    lands in the on-device persistent cache, where playback hits it
    //    locally with no round trip.
    //    Playback (and the whole intra-paragraph LOOKAHEAD, also 'high') no
    //    longer probes: the old gate was
    //      !(priority === 'low' && misses >= 3)
    //    whose inner conjunct is always false for 'high', so the miss-breaker
    //    could NEVER engage for playback by construction. On a cold book every
    //    single sentence paid a guaranteed-404 Cloudflare RTT — with a 12s
    //    deadline stacking on top of the 25s server deadline — before the GPU
    //    was even asked.
    const r2Url = getClaireR2Url();
    if (r2Url && priority === 'low' && this.#r2ConsecMisses < 3) {
      try {
        const url = `${r2Url}/audio/${hashText(text)}.mp3`;
        const r2resp = await fetchWithTimeout(url, { method: 'GET' }, 2500);
        if (r2resp.ok) {
          const buffer = await r2resp.arrayBuffer();
          if (isValidAudio(buffer)) {
            this.#r2ConsecMisses = 0;
            return { buffer, type: 'audio/mpeg' };
          }
        }
        this.#r2ConsecMisses++;
      } catch {
        // R2 miss/unreachable (or just-generated, not yet propagated) → generate.
        this.#r2ConsecMisses++;
      }
    }

    // R2 is configured, so Claire IS the intended engine: an empty serverUrl
    // means discovery failed, not "no server". Falling through to the Fish Audio
    // path here sent `Authorization: Bearer ` (the release build embeds no Fish
    // key) → 401 → several paragraphs of silence. Fail loudly instead; the next
    // sentence re-attempts discovery naturally because the cache is empty.
    if (!serverUrl && getClaireR2Url()) {
      throw new Error('Claire server URL not discovered (R2 server-url.txt)');
    }

    if (serverUrl) {
      // Self-hosted Claire server (user's GPU). Retry once on transient
      // failures (tunnel reset, 5xx, truncated body): a single silent drop
      // here used to skip the sentence for good.
      const body = JSON.stringify({ text, reference_id: 'claire' });
      const token = getClaireToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      // Playback ('high') preempts preload ('low') on the server's GPU queue so
      // the sentence being listened to never waits behind prefetched ones.
      headers['X-Claire-Priority'] = priority;

      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) break;
        try {
          // On retry, re-resolve the server URL — the tunnel may have moved.
          const target =
            attempt === 0
              ? serverUrl
              : (await resolveClaireServerUrl(tauriFetch, signal)) || serverUrl;
          // Priority-aware deadline. 60s for everything meant a slow chapter
          // opening blew the deadline, got retried blindly (see below), and the
          // reader heard up to TWO MINUTES of silence before the sentence was
          // finally skipped. Playback gets a much tighter budget so it fails
          // fast and recovers; background banking can afford to wait.
          deadlineFired = false;
          response = await fetchWithTimeout(
            `${target}/v1/tts`,
            { method: 'POST', headers, body },
            priority === 'high' ? 25000 : 60000,
          );
          if (!response.ok) {
            // 502/503/504 from Cloudflare = the tunnel points at a dead server.
            if (response.status >= 502 && response.status <= 504) {
              _discoveredServerUrl = '';
              _discoveredServerAt = 0;
            }
            const detail = await response.text().catch(() => '');
            throw new Error(`Claire server failed (${response.status}): ${detail.slice(0, 200)}`);
          }
          const buffer = await response.arrayBuffer();
          if (!isValidAudio(buffer)) throw new Error('No audio data received.');
          return { buffer, type: 'audio/mpeg' };
        } catch (err) {
          lastErr = err;
          if (signal.aborted) break;
          // Do NOT retry our own deadline. The server is single-GPU and is still
          // generating this exact sentence; re-POSTing it only queues a second
          // copy behind the first, doubling the wait (60s + 1.2s + 60s was the
          // observed two-minute chapter-opening stall). Transport errors — a
          // moved tunnel, a 5xx — are worth one retry.
          if (deadlineFired) break;
          // Stale tunnel URL is the usual cause — drop the discovery cache so
          // the retry (or the next call) re-resolves immediately.
          _discoveredServerUrl = '';
          _discoveredServerAt = 0;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }

    // Fish Audio fallback (free tier). Tauri calls the API directly via the
    // native HTTP plugin; web goes through the key-hiding proxy route.
    const payload = JSON.stringify({
      text,
      reference_id: voiceId,
      format: 'mp3',
      mp3_bitrate: 128,
    });
    if (tauriFetch) {
      response = await tauriFetch(FISH_AUDIO_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
          model: FISH_AUDIO_MODEL,
        },
        body: payload,
        signal,
      });
    } else {
      response = await fetch(`${getAPIBaseUrl()}/fishaudio/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal,
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Fish Audio TTS failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('No audio data received.');
    return { buffer, type: 'audio/mpeg' };
  }

  #storeInMemory(cacheKey: string, buffer: ArrayBuffer, type: string): string {
    const url = URL.createObjectURL(new Blob([buffer], { type }));
    // Overwriting the same key (a high-priority call superseding a stray preload
    // copy) must revoke the old URL for that key so it doesn't leak.
    const prev = this.#audioCache.get(cacheKey);
    if (prev && prev !== url) URL.revokeObjectURL(prev);
    // Bound the in-memory map and revoke evicted object URLs (the durable copy
    // lives in the persistent cache, so eviction here loses nothing).
    this.#audioCache.set(cacheKey, url);
    const liveA = this.#audioA?.src;
    const liveB = this.#audioB?.src;
    while (this.#audioCache.size > FISH_AUDIO_CACHE_MAX) {
      const oldestKey = this.#audioCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldUrl = this.#audioCache.get(oldestKey);
      this.#audioCache.delete(oldestKey);
      // Never revoke the URL we just created, nor one loaded into EITHER audio
      // element (playing or primed next) — revoking a live blob URL is exactly
      // what caused the "Audio playback error" glitch.
      if (oldUrl && oldUrl !== url && oldUrl !== liveA && oldUrl !== liveB) {
        URL.revokeObjectURL(oldUrl);
      }
    }
    return url;
  }

  getVoiceIdFromLang = (_lang: string): string => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, _lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    if (preferredVoice) return preferredVoice.id;
    return this.#currentVoiceId || FISH_AUDIO_DEFAULT_VOICE_ID;
  };

  async *speak(ssml: string, signal: AbortSignal, preload = false) {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      // Bank several sentences per upcoming paragraph (not just the first two)
      // so a deep buffer builds ahead of the playhead — low priority, so it only
      // fills the GPU's idle time and never delays the sentence being heard.
      const maxImmediate = 4;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        if (signal.aborted) break;
        const mark = marks[i]!;
        const voiceId = this.getVoiceIdFromLang(mark.language);
        try {
          await this.#synthesize(voiceId, mark.text, signal, 'low');
          // Reached only on success (throws are caught below): this sentence is
          // now banked ahead of the playhead — count it toward "minutes d'avance".
          this.#noteBanked(this.#cacheKey(voiceId, mark.text), mark.text.length);
        } catch (err) {
          console.warn('Fish Audio preload failed for mark', i, err);
        }
      }
      yield { code: 'end', message: 'Preload finished' } as TTSMessageEvent;
      return;
    }

    await this.stopInternal();
    if (!this.#audioA || !this.#audioB) {
      this.#audioA = new Audio();
      this.#audioB = new Audio();
      for (const a of [this.#audioA, this.#audioB]) {
        a.setAttribute('x-webkit-airplay', 'deny');
        a.preload = 'auto';
        // Explicit for WebKit variants; Chromium defaults to true.
        (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      }
    }
    let cur = this.#audioA!;
    let nxt = this.#audioB!;

    // Pipeline synthesis within the paragraph: keep upcoming sentences
    // generating while the current one plays. Adaptive depth: at higher speech
    // rates the pipeline must reach further ahead to keep slack positive on a
    // ~realtime GPU. 'high' priority so these preempt cross-paragraph preloads.
    const LOOKAHEAD = Math.max(3, 1 + Math.ceil(2 * this.#rate));
    const prefetchMark = (i: number) => {
      if (i < 0 || i >= marks.length) return;
      const m = marks[i]!;
      void this.#synthesize(this.getVoiceIdFromLang(m.language), m.text, signal, 'high').catch(
        () => {},
      );
    };
    for (let i = 0; i < LOOKAHEAD; i++) prefetchMark(i);

    // Consecutive per-sentence synthesis failures. One bad sentence must not
    // discard the rest of the paragraph, but a wedged server must still stop.
    let consecutiveMarkErrors = 0;
    for (let markIdx = 0; markIdx < marks.length; markIdx++) {
      const mark = marks[markIdx]!;
      // Keep the pipeline full: start generating the sentence LOOKAHEAD ahead.
      prefetchMark(markIdx + LOOKAHEAD);
      let abortHandler: null | (() => void) = null;
      try {
        const voiceId = this.getVoiceIdFromLang(mark.language);
        this.#currentVoiceId = voiceId;
        this.#speakingLang = mark.language;
        let audioUrl = await this.#synthesize(voiceId, mark.text, signal, 'high');
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }

        this.controller?.dispatchSpeakMark(mark);
        // This sentence is now playing — it's no longer "ahead", so drop it from
        // the banked-ahead tally (keyed by the same final text as when banked).
        this.#noteConsumed(this.#cacheKey(voiceId, mark.text));
        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const audio = cur;
        const standby = nxt;
        this.#audioElement = audio;
        let finishCurrent: ((ev: TTSMessageEvent) => void) | null = null;
        let primedUrl: string | null = null;

        abortHandler = () => {
          audio.pause();
          standby.pause();
          audio.removeAttribute('src');
          standby.removeAttribute('src');
          finishCurrent?.({ code: 'error', message: 'Aborted' });
        };
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }
        signal.addEventListener('abort', abortHandler);

        // Prime the STANDBY element with the next sentence while this one
        // plays: the browser decodes it during playback, and the 'ended'
        // handler starts it synchronously — the per-sentence gap disappears.
        const nextIdx = markIdx + 1;
        if (nextIdx < marks.length) {
          const nm = marks[nextIdx]!;
          void this.#synthesize(this.getVoiceIdFromLang(nm.language), nm.text, signal, 'high')
            .then((u) => {
              if (!u || signal.aborted) return;
              primedUrl = u;
              if (standby.src !== u) {
                standby.src = u;
                standby.load();
              }
              standby.playbackRate = this.#rate;
            })
            .catch(() => {});
        }

        const playOnce = (url: string) =>
          new Promise<TTSMessageEvent>((resolve) => {
            let resolved = false;
            const finish = (ev: TTSMessageEvent) => {
              if (resolved) return;
              resolved = true;
              audio.onended = null;
              audio.onerror = null;
              finishCurrent = null;
              resolve(ev);
            };
            finishCurrent = finish;
            audio.onended = () => {
              // Gap killer: start the primed next sentence inside the event
              // handler, before any generator/controller bookkeeping runs.
              if (!signal.aborted && primedUrl && standby.src === primedUrl) {
                standby.volume = 1;
                standby.playbackRate = this.#rate;
                void standby.play().catch(() => {});
              }
              finish({ code: 'end', message: `Chunk finished: ${mark.name}` });
            };
            audio.onerror = (e) => {
              console.warn('Fish Audio playback error:', e);
              finish({ code: 'error', message: 'Audio playback error' });
            };
            audio.volume = 1;
            if (audio.src !== url) {
              audio.src = url;
            }
            if (!this.appService?.isLinuxApp) {
              audio.playbackRate = this.#rate;
            }
            // The user paused while this sentence was still being synthesized.
            // Park it: the promise stays pending with onended/onerror armed, src
            // set and #audioElement pointing here, so resume() starts exactly
            // this element. MUST be before `#isPlaying = true` — bailing after
            // would make resume() early-return and deadlock playback.
            if (this.#paused) return;
            this.#isPlaying = true;
            audio
              .play()
              .then(() => {
                if (this.appService?.isLinuxApp) {
                  audio.playbackRate = this.#rate;
                }
              })
              .catch((err) => {
                // A pause landing inside the play() window rejects with
                // AbortError. Leave the promise PARKED so resume() restarts this
                // same element (its onended is still armed) instead of finishing
                // the sentence and skipping it.
                if (!this.#isPlaying) return;
                console.error('Failed to play Fish Audio audio:', err);
                finish({ code: 'error', message: 'Playback failed: ' + err.message });
              });
            // The clip may have ended in the microtask gap (ultra-short audio).
            if (audio.ended) {
              finish({ code: 'end', message: `Chunk finished: ${mark.name}` });
            }
          });

        let result = await playOnce(audioUrl);
        if (
          result.code === 'error' &&
          result.message === 'Audio playback error' &&
          !signal.aborted
        ) {
          // Corrupt or revoked blob: purge every cache layer for this sentence
          // and regenerate once — otherwise it would fail on every future read.
          const cacheKey = this.#cacheKey(voiceId, mark.text);
          const bad = this.#audioCache.get(cacheKey);
          if (bad) {
            this.#audioCache.delete(cacheKey);
            URL.revokeObjectURL(bad);
          }
          await deletePersistedAudio(voiceId, mark.text);
          try {
            audioUrl = await this.#synthesize(voiceId, mark.text, signal, 'high');
            if (!signal.aborted) result = await playOnce(audioUrl);
          } catch {
            // Keep the original error result; the controller advances past it.
          }
        }
        yield result;
        if (result.code === 'end') consecutiveMarkErrors = 0;
        // A play() rejection (audio-focus loss, autoplay gating) produces
        // 'Playback failed: ...', which the regenerate gate above deliberately
        // does NOT match. Without a bound the loop advanced, every following
        // mark was an in-memory LOOKAHEAD cache hit, and the paragraph raced to
        // its end dispatching highlights with NO AUDIO — the "it skips words"
        // report. Bound at 2, matching the synthesis-failure policy below.
        if (result.code === 'error' && ++consecutiveMarkErrors >= 2) break;
        if (signal.aborted) break;
        [cur, nxt] = [nxt, cur];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Fish Audio TTS error for mark:', mark.text, message);
        // Surface a terminal 'error' (never a fake 'end') so the controller can
        // react. But do NOT break on the first failure: breaking here discarded
        // every REMAINING sentence of the paragraph — the controller only sees
        // the last code, treats it as "advance", and jumps to the next
        // paragraph. One transient 5xx/tunnel reset on sentence 2 of 7 silently
        // deleted sentences 2-7. Continue to the next sentence instead, bounded
        // so a wedged tunnel (60s per attempt) can't stall for minutes.
        yield { code: 'error', message } as TTSMessageEvent;
        if (signal.aborted || ++consecutiveMarkErrors >= 2) break;
      } finally {
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    await this.stopInternal();
  }

  async pause() {
    // FIRST, above the early return: a pause tapped during a synthesis gap (the
    // first sentence of every cold paragraph, where speak() already called
    // stopInternal so #isPlaying is false) used to be silently dropped — the
    // transport showed 'paused' and Claire started talking seconds later.
    this.#paused = true;
    if (!this.#isPlaying || !this.#audioElement) return true;
    this.#audioElement.pause();
    this.#isPlaying = false;
    return true;
  }

  async resume() {
    this.#paused = false;
    // After stopInternal removed the attribute a stale element reports src === ''
    // — playing it would reject and wedge the session.
    if (this.#isPlaying || !this.#audioElement?.src) return true;
    await this.#audioElement.play().catch(() => {});
    this.#isPlaying = true;
    return true;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
    this.#isPlaying = false;
    // speak() calls stopInternal at its start, so a stale true would mute a
    // fresh session.
    this.#paused = false;
    // Clean BOTH buffered elements. Never invoke onended here: with
    // double-buffering it would chain-start the primed next sentence.
    for (const a of [this.#audioA, this.#audioB]) {
      if (!a) continue;
      a.onended = null;
      a.onerror = null;
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        // No source loaded — nothing to rewind.
      }
      a.removeAttribute('src');
      a.volume = 1;
    }
  }

  async setRate(rate: number) {
    this.#rate = rate;
  }

  async setPitch(_pitch: number) {
    // Fish Audio's s2.1 model does not expose a pitch control; ignored.
  }

  async setVoice(voice: string) {
    const selectedVoice = this.#voices.find((v) => v.id === voice);
    if (selectedVoice) {
      this.#currentVoiceId = selectedVoice.id;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    this.#voices.forEach((voice) => {
      voice.disabled = !this.initialized;
    });
    return this.#voices;
  }

  async getVoices(lang: string): Promise<TTSVoicesGroup[]> {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    // Fish Audio currently exposes a single curated French voice (Claire). Keep
    // it available for every book language so it can always be selected as the
    // narration voice; the requested locale's matches still sort first.
    const sameLang = voices.filter((v) => isSameLang(v.lang, lang));
    const filteredVoices = sameLang.length > 0 ? sameLang : voices;

    const voicesGroup: TTSVoicesGroup = {
      id: 'fish-audio',
      name: 'Fish Audio',
      voices: filteredVoices.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale)),
      disabled: !this.initialized || filteredVoices.length === 0,
    };

    return [voicesGroup];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  supportsWordBoundaries(): boolean {
    // false: fish-speech returns NO word timings. The old "synthetic" karaoke
    // interpolated positions from character counts, and requestAnimationFrame is
    // throttled or halted when the screen is off — so the highlight froze during
    // background playback then jumped. Structurally untunable, now deleted.
    // This flag also gates #suppressMarkHighlight in TTSController: returning
    // true with no tracker running would suppress the sentence highlight and
    // draw nothing at all.
    return false;
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#currentVoiceId;
  }

  getSpeakingLang(): string {
    return this.#speakingLang;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    await this.stopInternal();
    this.#audioElement = null;
    this.#audioA = null;
    this.#audioB = null;
    for (const url of this.#audioCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.#audioCache.clear();
    // Reset the banked-ahead tally + notify zero so the TTS bar clears its
    // "minutes d'avance" when the book is closed.
    this.#bankedAhead.clear();
    if (this.#bankedNotifyTimer) {
      clearTimeout(this.#bankedNotifyTimer);
      this.#bankedNotifyTimer = null;
    }
    this.controller?.dispatchEvent(new CustomEvent('tts-banked-ahead', { detail: { minutes: 0 } }));
  }
}
