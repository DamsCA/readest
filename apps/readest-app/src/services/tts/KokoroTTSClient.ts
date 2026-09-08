import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { isTauriAppPlatform } from '@/services/environment';

// Kokoro-82M, running on the user's own GPU (D:\Chatterbox, RTX 3050).
//
// Why this exists alongside Gemini: the owner's requirement was "the quality of
// a paid engine, with the same no-account, no-quota freedom Edge has". Kokoro is
// Apache-2.0, runs entirely on his machine, and costs nothing per sentence, so
// re-reading a book forever is free — no key, no billing page, no rate limit.
//
// Measured end-to-end on 8 Sept 2026, through the Cloudflare tunnel (i.e. the
// exact path the phone uses): x6.8 real time, 648 ms per sentence, 0.55 s when
// the server replays from its own disk cache. Pure inference is x18-x29. The
// Claire/fish-speech server it replaces ran at roughly x1 and was the source of
// essentially every stall.
//
// HONEST LIMITATION: Kokoro publishes exactly ONE native French voice
// (ff_siwis). Every other entry in the menu is a tensor blend of that voice with
// a non-French one — phonemization stays French (lang_code="f"), only the timbre
// shifts. Measured median-pitch spread across the roster is 171-207 Hz, so these
// are variations on one voice, NOT sixteen different speakers. Gemini remains
// the option when genuinely distinct voices matter.

// Same R2 bucket as the Claire server: the Kokoro supervisor publishes its
// current tunnel URL there under a different key.
const getR2Url = () => (process.env['NEXT_PUBLIC_CLAIRE_R2_URL'] || '').replace(/\/+$/, '');
// Escape hatch for a fixed LAN address (e.g. "http://192.168.0.130:8890"),
// which skips discovery entirely.
const getBakedServerUrl = () =>
  (process.env['NEXT_PUBLIC_KOKORO_SERVER_URL'] || '').replace(/\/+$/, '');

const DISCOVERY_KEY = 'kokoro-url.txt';
const SERVER_URL_TTL_MS = 60 * 1000;

let _discoveredUrl = '';
let _discoveredAt = 0;
let _discoveryInFlight: Promise<string> | null = null;

// Takes no AbortSignal by design — see the comment inside.
const resolveServerUrl = async (tauriFetch: typeof fetch | null): Promise<string> => {
  const baked = getBakedServerUrl();
  if (baked) return baked;
  const r2 = getR2Url();
  if (!r2) return '';
  const now = Date.now();
  if (_discoveredUrl && now - _discoveredAt < SERVER_URL_TTL_MS) return _discoveredUrl;
  if (_discoveryInFlight) return _discoveryInFlight;

  _discoveryInFlight = (async () => {
    // Bounded by its OWN deadline, never chained to a caller's AbortSignal.
    // This promise is shared by every concurrent caller, so honouring one
    // caller's abort would cancel discovery for all of them — and since the
    // first caller is usually a low-priority preload that every paragraph
    // advance aborts, playback would receive an empty URL and abandon the
    // paragraph without a single request reaching the server. That exact bug
    // cost a release on the Claire client; it is not repeated here.
    // Hand-rolled rather than AbortSignal.timeout: this runs in Android's
    // System WebView, which can predate it.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const url = `${r2}/${DISCOVERY_KEY}`;
      const opts = { method: 'GET', signal: ctrl.signal } as RequestInit;
      const resp = tauriFetch ? await tauriFetch(url, opts) : await fetch(url, opts);
      if (resp.ok) {
        const discovered = (await resp.text()).trim().replace(/\/+$/, '');
        if (/^https?:\/\//.test(discovered)) {
          _discoveredUrl = discovered;
          _discoveredAt = Date.now();
          return discovered;
        }
      }
    } catch {
      // Unreachable — fall back to the last known URL (possibly empty).
    } finally {
      clearTimeout(timer);
    }
    return _discoveredUrl;
  })().finally(() => {
    _discoveryInFlight = null;
  });

  return _discoveryInFlight;
};

// Mirrors VOICES in D:\Chatterbox\kokoro_server.py. Declared statically so the
// menu is populated before the server is ever contacted; refreshed from
// /voices at init when it is reachable.
const KOKORO_VOICES: TTSVoice[] = [
  { id: 'siwis', name: 'Siwis — française native', lang: 'fr-FR' },
  { id: 'bella', name: 'Bella — chaude, ronde', lang: 'fr-FR' },
  { id: 'heart', name: 'Heart — douce, proche', lang: 'fr-FR' },
  { id: 'nicole', name: 'Nicole — intime, feutrée', lang: 'fr-FR' },
  { id: 'sarah', name: 'Sarah — posée, narrative', lang: 'fr-FR' },
  { id: 'nova', name: 'Nova — claire, présente', lang: 'fr-FR' },
  { id: 'aoede', name: 'Aoede — souple, musicale', lang: 'fr-FR' },
  { id: 'kore', name: 'Kore — nette, assurée', lang: 'fr-FR' },
  { id: 'river', name: 'River — calme, égale', lang: 'fr-FR' },
  { id: 'emma', name: 'Emma — britannique adoucie', lang: 'fr-FR' },
  { id: 'isabella', name: 'Isabella — grave, ample', lang: 'fr-FR' },
  { id: 'alice', name: 'Alice — légère, vive', lang: 'fr-FR' },
  { id: 'sara', name: 'Sara — timbre latin', lang: 'fr-FR' },
  { id: 'dora', name: 'Dora — timbre hispanique', lang: 'fr-FR' },
  { id: 'bella2', name: 'Bella marquée — 50/50', lang: 'fr-FR' },
  { id: 'nicole2', name: 'Nicole marquée — 50/50', lang: 'fr-FR' },
];
const DEFAULT_VOICE = KOKORO_VOICES[0]!.id;

const PERSIST_CACHE_NAME = 'kokoro-tts-audio-v1';

const hashText = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
};

const persistRequest = (voiceId: string, text: string) =>
  new Request(`https://kokoro-tts.local/${encodeURIComponent(voiceId)}/${hashText(text)}`);

let _persistCachePromise: Promise<Cache> | null = null;
const openPersistCache = (): Promise<Cache> | null => {
  if (typeof caches === 'undefined') return null;
  if (!_persistCachePromise) _persistCachePromise = caches.open(PERSIST_CACHE_NAME);
  return _persistCachePromise;
};

const readPersistedAudio = async (voiceId: string, text: string): Promise<ArrayBuffer | null> => {
  const cacheP = openPersistCache();
  if (!cacheP) return null;
  try {
    const hit = await (await cacheP).match(persistRequest(voiceId, text));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
};

const writePersistedAudio = async (voiceId: string, text: string, buffer: ArrayBuffer) => {
  const cacheP = openPersistCache();
  if (!cacheP) return;
  try {
    await (await cacheP).put(
      persistRequest(voiceId, text),
      new Response(buffer, { headers: { 'Content-Type': 'audio/wav' } }),
    );
  } catch {
    // Quota or private mode — playback still works, it just re-synthesizes.
  }
};

// A WAV header is 44 bytes; anything near that carries no samples.
const isValidAudio = (buffer: ArrayBuffer): boolean => buffer.byteLength > 1024;

// parseSSMLMarks never decodes entities, but the server receives PLAIN text —
// an escaped ampersand would otherwise be read out literally.
const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, String.fromCharCode(39))
    .replace(/&apos;/g, String.fromCharCode(39))
    .replace(/&amp;/g, '&');

const MAX_MEM_CACHE = 64;

export class KokoroTTSClient implements TTSClient {
  name = 'kokoro-tts';
  initialized = false;

  controller?: TTSController;
  appService?: AppService | null;

  #voices: TTSVoice[] = KOKORO_VOICES.map((v) => ({ ...v }));
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = DEFAULT_VOICE;
  #rate = 1.0;

  #audioA: HTMLAudioElement | null = null;
  #audioB: HTMLAudioElement | null = null;
  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  // User pressed pause. Distinct from #isPlaying: a pause can land while a
  // sentence is still being SYNTHESIZED, i.e. before any audio exists.
  #paused = false;

  #memCache = new Map<string, string>();

  constructor(controller?: TTSController, appService?: AppService | null) {
    this.controller = controller;
    this.appService = appService;
  }

  async init() {
    // The server MUST answer before this engine reports itself available.
    //
    // An earlier version returned true as soon as an R2 URL was configured,
    // reasoning that the PC might wake up later. That shipped in claire.36 and
    // broke reading outright: an available-but-dead Kokoro won the
    // `voiceId === ''` branch in TTSController.setVoice, which then persisted
    // 'kokoro-tts' as the preferred client — so every subsequent launch also
    // selected a server that was not running, and nothing was ever read aloud.
    // Being honest about availability is what keeps that from recurring.
    if (!getR2Url() && !getBakedServerUrl()) {
      this.initialized = false;
      return false;
    }
    this.initialized = await this.#serverAnswers();
    if (this.initialized) void this.#refreshVoices();
    return this.initialized;
  }

  async #serverAnswers(): Promise<boolean> {
    try {
      const tauriFetch = isTauriAppPlatform()
        ? (await import('@tauri-apps/plugin-http')).fetch
        : null;
      const serverUrl = await resolveServerUrl(tauriFetch);
      if (!serverUrl) return false;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const doFetch = tauriFetch ?? fetch;
      const resp = await doFetch(`${serverUrl}/health`, { method: 'GET', signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return false;
      const body = (await resp.json()) as { status?: string; ready?: boolean };
      // `ready` is false while the model is still loading onto the GPU, which
      // takes ~2 min from cold. Offering the engine before then would hand the
      // reader a server that answers and still cannot speak.
      return body.status === 'ok' && body.ready === true;
    } catch {
      return false;
    }
  }

  // Best-effort: keeps the menu honest if the server's roster ever changes,
  // but never blocks or fails init.
  async #refreshVoices() {
    try {
      const tauriFetch = isTauriAppPlatform()
        ? (await import('@tauri-apps/plugin-http')).fetch
        : null;
      const serverUrl = await resolveServerUrl(tauriFetch);
      if (!serverUrl) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const doFetch = tauriFetch ?? fetch;
      const resp = await doFetch(`${serverUrl}/voices`, { method: 'GET', signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return;
      const list = (await resp.json()) as { id?: string; name?: string }[];
      const fresh = list
        .filter((v) => !!v.id)
        .map((v) => ({ id: v.id!, name: v.name || v.id!, lang: 'fr-FR' }));
      if (fresh.length) this.#voices = fresh;
    } catch {
      // Server asleep or unreachable — the static roster stands.
    }
  }

  async #synthesize(voiceId: string, rawText: string, signal: AbortSignal): Promise<string> {
    const text = decodeEntities(rawText).trim();
    if (!text) return '';
    const cacheKey = `${voiceId}|${text}`;
    const cached = this.#memCache.get(cacheKey);
    if (cached) return cached;

    const persisted = await readPersistedAudio(voiceId, text);
    if (persisted) return this.#storeInMemory(cacheKey, persisted);

    const tauriFetch = isTauriAppPlatform()
      ? (await import('@tauri-apps/plugin-http')).fetch
      : null;
    const serverUrl = await resolveServerUrl(tauriFetch);
    if (!serverUrl) throw new Error('Kokoro server URL not discovered (R2 kokoro-url.txt)');

    const doFetch = tauriFetch ?? fetch;
    const resp = await doFetch(`${serverUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // speed stays 1.0 on purpose: the server caches by (voice, speed, text),
      // so varying it there would fragment the cache. Reading speed is applied
      // on the audio element instead, which costs nothing and is instant.
      body: JSON.stringify({ text, voice: voiceId, speed: 1.0 }),
      signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      // A stale tunnel URL is the usual cause: drop the cache so the next
      // sentence rediscovers instead of hammering a dead hostname.
      if (resp.status >= 500 || resp.status === 404) {
        _discoveredUrl = '';
        _discoveredAt = 0;
      }
      throw new Error(`Kokoro TTS failed (${resp.status}): ${detail.slice(0, 200)}`);
    }
    const buffer = await resp.arrayBuffer();
    if (!isValidAudio(buffer)) throw new Error('Kokoro TTS returned invalid audio');
    await writePersistedAudio(voiceId, text, buffer);
    return this.#storeInMemory(cacheKey, buffer);
  }

  #storeInMemory(cacheKey: string, buffer: ArrayBuffer): string {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    const previous = this.#memCache.get(cacheKey);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    this.#memCache.set(cacheKey, url);
    while (this.#memCache.size > MAX_MEM_CACHE) {
      const oldest = this.#memCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const stale = this.#memCache.get(oldest);
      this.#memCache.delete(oldest);
      // Never revoke a URL an element is still holding.
      if (stale && stale !== this.#audioA?.src && stale !== this.#audioB?.src) {
        URL.revokeObjectURL(stale);
      }
    }
    return url;
  }

  async *speak(ssml: string, signal: AbortSignal, preload = false): AsyncIterable<TTSMessageEvent> {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      for (const mark of marks.slice(0, 3)) {
        if (signal.aborted) return;
        try {
          await this.#synthesize(this.getVoiceIdFromLang(mark.language), mark.text, signal);
        } catch {
          // Preload is best-effort.
        }
      }
      return;
    }

    await this.stopInternal();
    if (!this.#audioA) this.#audioA = new Audio();
    if (!this.#audioB) this.#audioB = new Audio();
    let cur = this.#audioA;
    let nxt = this.#audioB;

    // One bad sentence must not discard the rest of the paragraph, but a wedged
    // network must still stop: bounded at 2 consecutive failures.
    let consecutiveErrors = 0;

    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]!;
      let abortHandler: null | (() => void) = null;
      try {
        const voiceId = this.getVoiceIdFromLang(mark.language);
        this.#speakingLang = mark.language;
        const url = await this.#synthesize(voiceId, mark.text, signal);
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }
        if (!url) continue;

        this.controller?.dispatchSpeakMark(mark);
        yield { code: 'boundary', message: `Start chunk: ${mark.name}`, mark: mark.name };

        // Warm the next sentence while this one plays, so the gap disappears.
        if (i + 1 < marks.length) {
          const nm = marks[i + 1]!;
          void this.#synthesize(this.getVoiceIdFromLang(nm.language), nm.text, signal).catch(
            () => {},
          );
        }

        const audio = cur;
        this.#audioElement = audio;
        let finishCurrent: ((ev: TTSMessageEvent) => void) | null = null;

        abortHandler = () => {
          audio.pause();
          audio.removeAttribute('src');
          finishCurrent?.({ code: 'error', message: 'Aborted' });
        };
        signal.addEventListener('abort', abortHandler);

        const result = await new Promise<TTSMessageEvent>((resolve) => {
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
          audio.onended = () => finish({ code: 'end', message: `Chunk finished: ${mark.name}` });
          audio.onerror = () => finish({ code: 'error', message: 'Audio playback error' });

          audio.volume = 1;
          if (audio.src !== url) audio.src = url;
          audio.playbackRate = Math.min(4, Math.max(0.25, this.#rate));
          // The user paused while this sentence was still being synthesized.
          // Park it: the promise stays pending with handlers armed and src set,
          // so resume() starts exactly this element. MUST come before
          // `#isPlaying = true` — bailing after would deadlock resume.
          if (this.#paused) return;
          this.#isPlaying = true;
          audio.play().catch((err) => {
            // A pause landing inside the play() window rejects with AbortError.
            // Leave the promise parked rather than skipping the sentence.
            if (!this.#isPlaying) return;
            finish({ code: 'error', message: 'Playback failed: ' + err.message });
          });
          if (audio.ended) finish({ code: 'end', message: `Chunk finished: ${mark.name}` });
        });

        yield result;
        if (result.code === 'end') consecutiveErrors = 0;
        if (signal.aborted) break;
        if (result.code === 'error' && ++consecutiveErrors >= 2) break;
        [cur, nxt] = [nxt, cur];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Kokoro TTS error for mark:', mark.text, message);
        yield { code: 'error', message } as TTSMessageEvent;
        if (signal.aborted || ++consecutiveErrors >= 2) break;
      } finally {
        if (abortHandler) signal.removeEventListener('abort', abortHandler);
      }
    }
    await this.stopInternal();
  }

  async pause() {
    this.#paused = true;
    if (!this.#isPlaying || !this.#audioElement) return true;
    this.#audioElement.pause();
    this.#isPlaying = false;
    return true;
  }

  async resume() {
    this.#paused = false;
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
    this.#paused = false;
    for (const a of [this.#audioA, this.#audioB]) {
      if (!a) continue;
      a.onended = null;
      a.onerror = null;
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        // Detached element.
      }
      a.removeAttribute('src');
    }
  }

  async setRate(rate: number) {
    this.#rate = rate;
  }

  async setPitch(_pitch: number) {
    // Kokoro exposes no pitch control; accepted for interface parity.
  }

  async setVoice(voice: string) {
    this.#currentVoiceId = voice;
  }

  // Every voice is French-phonemized, so the book's language never restricts
  // the choice — it only decides which stored preference to look up.
  getVoiceIdFromLang = (lang: string): string => {
    const preferred = TTSUtils.getPreferredVoice(this.name, lang);
    if (preferred && this.#voices.some((v) => v.id === preferred)) return preferred;
    return this.#currentVoiceId || DEFAULT_VOICE;
  };

  async getAllVoices(): Promise<TTSVoice[]> {
    this.#voices.forEach((v) => (v.disabled = !this.initialized));
    return this.#voices;
  }

  async getVoices(_lang: string): Promise<TTSVoicesGroup[]> {
    const all = await this.getAllVoices();
    return [
      {
        id: 'kokoro-tts',
        name: 'Kokoro — voix féminines (ton PC, illimité)',
        voices: all,
        disabled: !this.initialized,
      },
    ];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  supportsWordBoundaries(): boolean {
    // No word timings are returned. Sentence-level highlighting is always in
    // sync; a synthetic word tracker is not — that lesson cost a month.
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

  async shutdown() {
    await this.stopInternal();
    for (const url of this.#memCache.values()) URL.revokeObjectURL(url);
    this.#memCache.clear();
    this.#audioA = null;
    this.#audioB = null;
    this.#audioElement = null;
    this.initialized = false;
  }
}
