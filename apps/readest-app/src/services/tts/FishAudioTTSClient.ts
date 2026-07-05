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
const FISH_AUDIO_CACHE_MAX = 24;

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
const getClaireR2Url = () =>
  (process.env['NEXT_PUBLIC_CLAIRE_R2_URL'] || '').replace(/\/+$/, '');

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
  try {
    const url = `${r2}/server-url.txt`;
    const resp = tauriFetch
      ? await tauriFetch(url, { method: 'GET', signal })
      : await fetch(url, { method: 'GET', signal });
    if (resp.ok) {
      const discovered = (await resp.text()).trim().replace(/\/+$/, '');
      if (/^https?:\/\//.test(discovered)) {
        _discoveredServerUrl = discovered;
        _discoveredServerAt = now;
        return discovered;
      }
    }
  } catch {
    // Discovery failed — fall back to whatever we last knew (may be empty).
  }
  return _discoveredServerUrl;
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

const readPersistedAudio = async (
  voiceId: string,
  text: string,
): Promise<{ buffer: ArrayBuffer; type: string } | null> => {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(PERSIST_CACHE_NAME);
    const res = await cache.match(persistRequest(voiceId, text));
    if (!res) return null;
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength) return null;
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
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(PERSIST_CACHE_NAME);
    await cache.put(
      persistRequest(voiceId, text),
      new Response(buffer, { headers: { 'Content-Type': type } }),
    );
  } catch {
    // Storage unavailable/full — degrade to in-memory only, don't break playback.
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

  #voices: TTSVoice[] = FISH_AUDIO_VOICES;
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = FISH_AUDIO_DEFAULT_VOICE_ID;
  #rate = 1.0;

  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;
  // Small cache of synthesized audio object URLs keyed by `${voiceId}:${text}`,
  // populated by preload so playback can start without a round-trip.
  #audioCache = new Map<string, string>();
  // In-flight requests keyed by cacheKey, so the same sentence is never
  // generated twice concurrently (e.g. playback catching up to a preload).
  #inFlight = new Map<string, { promise: Promise<string>; priority: 'high' | 'low' }>();

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
    if (cached) return cached;

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
      // 1) Persistent on-device cache: audio generated in a previous session.
      //    This is the "PC off / offline" path — no server needed.
      const persisted = await readPersistedAudio(voiceId, text);
      if (persisted) {
        return this.#storeInMemory(cacheKey, persisted.buffer, persisted.type);
      }

      // 2) Generate (Claire server preferred, Fish Audio fallback), then persist
      //    forever so it never has to be generated again.
      const { buffer, type } = await this.#fetchAudio(voiceId, text, signal, priority);
      await writePersistedAudio(voiceId, text, buffer, type);
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
    const serverUrl = await resolveClaireServerUrl(tauriFetch, signal);

    // 0) Cloud (R2) first: if this exact sentence was ever generated, its MP3
    //    is already banked in R2 — play it with the PC off / offline. The key
    //    matches the Claire server's r2_key(text): "audio/<djb2>-<len>.mp3".
    const r2Url = getClaireR2Url();
    if (r2Url) {
      try {
        const url = `${r2Url}/audio/${hashText(text)}.mp3`;
        const r2resp = tauriFetch
          ? await tauriFetch(url, { method: 'GET', signal })
          : await fetch(url, { method: 'GET', signal });
        if (r2resp.ok) {
          const buffer = await r2resp.arrayBuffer();
          if (buffer.byteLength) return { buffer, type: 'audio/mpeg' };
        }
      } catch {
        // R2 miss/unreachable (or just-generated, not yet propagated) → generate.
      }
    }

    if (serverUrl) {
      // Self-hosted Claire server (user's GPU). Reference id is fixed to the
      // server-side "claire" voice folder. Returns WAV.
      const body = JSON.stringify({ text, reference_id: 'claire' });
      const url = `${serverUrl}/v1/tts`;
      const token = getClaireToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      // Playback ('high') preempts preload ('low') on the server's GPU queue so
      // the sentence being listened to never waits behind prefetched ones.
      headers['X-Claire-Priority'] = priority;
      const opts: RequestInit = { method: 'POST', headers, body, signal };
      try {
        response = tauriFetch ? await tauriFetch(url, opts) : await fetch(url, opts);
      } catch (err) {
        // Network error usually means the tunnel URL is stale (server restarted
        // → new URL published to R2). Drop the cache so the next call re-resolves
        // it immediately instead of waiting out the TTL.
        _discoveredServerUrl = '';
        _discoveredServerAt = 0;
        throw err;
      }
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
      if (!buffer.byteLength) throw new Error('No audio data received.');
      return { buffer, type: 'audio/wav' };
    }

    // Fish Audio fallback (free tier). Tauri calls the API directly via the
    // native HTTP plugin; web goes through the key-hiding proxy route.
    const payload = JSON.stringify({ text, reference_id: voiceId, format: 'mp3', mp3_bitrate: 128 });
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
    // Bound the in-memory map and revoke evicted object URLs (the durable copy
    // lives in the persistent cache, so eviction here loses nothing).
    this.#audioCache.set(cacheKey, url);
    while (this.#audioCache.size > FISH_AUDIO_CACHE_MAX) {
      const oldestKey = this.#audioCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldUrl = this.#audioCache.get(oldestKey);
      this.#audioCache.delete(oldestKey);
      if (oldUrl && oldUrl !== url) URL.revokeObjectURL(oldUrl);
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
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        if (signal.aborted) break;
        const mark = marks[i]!;
        const voiceId = this.getVoiceIdFromLang(mark.language);
        try {
          await this.#synthesize(voiceId, mark.text, signal, 'low');
        } catch (err) {
          console.warn('Fish Audio preload failed for mark', i, err);
        }
      }
      yield { code: 'end', message: 'Preload finished' } as TTSMessageEvent;
      return;
    }

    await this.stopInternal();
    if (!this.#audioElement) {
      this.#audioElement = new Audio();
    }
    const audio = this.#audioElement;
    audio.setAttribute('x-webkit-airplay', 'deny');
    audio.preload = 'auto';

    // Pipeline synthesis within the paragraph: keep the next couple of sentences
    // generating while the current one plays, so there's no stall on each new
    // sentence. #synthesize dedups + caches, so awaiting an already-prefetched
    // mark is an instant cache hit. These are 'high' (imminent playback), so
    // they preempt the low-priority preload of later paragraphs on the GPU.
    const LOOKAHEAD = 2;
    const prefetchMark = (i: number) => {
      if (i < 0 || i >= marks.length) return;
      const m = marks[i]!;
      void this.#synthesize(this.getVoiceIdFromLang(m.language), m.text, signal, 'high').catch(
        () => {},
      );
    };
    for (let i = 0; i < LOOKAHEAD; i++) prefetchMark(i);

    for (let markIdx = 0; markIdx < marks.length; markIdx++) {
      const mark = marks[markIdx]!;
      this.controller?.dispatchSpeakMark(mark);
      // Keep the pipeline full: start generating the sentence LOOKAHEAD ahead.
      prefetchMark(markIdx + LOOKAHEAD);
      let abortHandler: null | (() => void) = null;
      try {
        const voiceId = this.getVoiceIdFromLang(mark.language);
        this.#currentVoiceId = voiceId;
        this.#speakingLang = mark.language;
        const audioUrl = await this.#synthesize(voiceId, mark.text, signal, 'high');
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          const cleanUp = () => {
            audio.onended = null;
            audio.onerror = null;
            audio.src = '';
          };
          let resolved = false;
          const handleEnded = () => {
            if (resolved) return;
            resolved = true;
            cleanUp();
            resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
          };
          abortHandler = () => {
            cleanUp();
            resolve({ code: 'error', message: 'Aborted' });
          };
          if (signal.aborted) {
            abortHandler();
            return;
          } else {
            signal.addEventListener('abort', abortHandler);
          }
          audio.onended = handleEnded;
          audio.onerror = (e) => {
            cleanUp();
            console.warn('Fish Audio playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };
          this.#isPlaying = true;
          audio.src = audioUrl;
          if (!this.appService?.isLinuxApp) {
            audio.playbackRate = this.#rate;
          }
          audio
            .play()
            .then(() => {
              if (this.appService?.isLinuxApp) {
                audio.playbackRate = this.#rate;
              }
            })
            .catch((err) => {
              cleanUp();
              console.error('Failed to play Fish Audio audio:', err);
              resolve({ code: 'error', message: 'Playback failed: ' + err.message });
            });
        });
        yield result;
      } catch (error) {
        if (error instanceof Error && error.message === 'No audio data received.') {
          console.warn('No audio data received for:', mark.text);
          yield { code: 'end', message: `Chunk finished: ${mark.name}` } as TTSMessageEvent;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Fish Audio TTS error for mark:', mark.text, message);
        yield { code: 'error', message } as TTSMessageEvent;
        break;
      } finally {
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    await this.stopInternal();
  }

  async pause() {
    if (!this.#isPlaying || !this.#audioElement) return true;
    this.#pausedAt = this.#audioElement.currentTime - this.#startedAt;
    await this.#audioElement.pause();
    this.#isPlaying = false;
    return true;
  }

  async resume() {
    if (this.#isPlaying || !this.#audioElement) return true;
    await this.#audioElement.play();
    this.#isPlaying = true;
    this.#startedAt = this.#audioElement.currentTime - this.#pausedAt;
    return true;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
    this.#isPlaying = false;
    this.#pausedAt = 0;
    this.#startedAt = 0;
    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.currentTime = 0;
      if (this.#audioElement?.onended) {
        this.#audioElement.onended(new Event('stopped'));
      }
      this.#audioElement.src = '';
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
    for (const url of this.#audioCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.#audioCache.clear();
  }
}
