import { getUserLocale } from '@/utils/misc';
import { isSameLang } from '@/utils/lang';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';

// Google Cloud Text-to-Speech. Chosen to replace the self-hosted Claire stack:
// comparable voice quality, but an API key is the ENTIRE infrastructure — no
// GPU, no WSL, no Cloudflare tunnel, no R2 bucket, no watchdog. Those were the
// source of essentially every outage: a 4GB VRAM ceiling, host RAM pressure
// killing the server, and a tunnel URL that changed on every restart.
const GOOGLE_TTS_SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GOOGLE_TTS_VOICES_URL = 'https://texttospeech.googleapis.com/v1/voices';

const getApiKey = () => process.env['NEXT_PUBLIC_GOOGLE_TTS_API_KEY'] || '';

// Used only when voices.list cannot be reached (offline, or the key is not yet
// authorized). The live list is always preferred so voices Google adds later
// show up without a rebuild.
const FALLBACK_FR_FEMALE: TTSVoice[] = [
  'Achernar',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Despina',
  'Erinome',
  'Gacrux',
  'Kore',
  'Laomedeia',
  'Leda',
  'Pulcherrima',
  'Sulafat',
  'Vindemiatrix',
  'Zephyr',
].map((n) => ({
  id: `fr-FR-Chirp3-HD-${n}`,
  name: `${n} (Chirp 3 HD)`,
  lang: 'fr-FR',
}));

// Persistent audio cache: "generate once, keep forever". Also the cost control —
// re-reading a passage never spends a second character of the monthly quota.
const PERSIST_CACHE_NAME = 'google-tts-audio-v1';

const hashText = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
};

const persistRequest = (voiceId: string, text: string) =>
  new Request(`https://google-tts.local/${encodeURIComponent(voiceId)}/${hashText(text)}`);

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
      new Response(buffer, { headers: { 'Content-Type': 'audio/mpeg' } }),
    );
  } catch {
    // Quota or private mode — playback still works, it just re-synthesizes.
  }
};

// A truncated body persisted as-is would make that exact sentence fail on every
// future read — a deterministic, permanent skip. Validate before caching.
const isValidAudio = (buffer: ArrayBuffer): boolean => {
  if (buffer.byteLength < 512) return false;
  const b = new Uint8Array(buffer, 0, 3);
  const isId3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  const isMpegFrame = b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
  return isId3 || isMpegFrame;
};

const base64ToBuffer = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

// parseSSMLMarks never decodes entities, but Google's input.text is PLAIN text —
// sending an escaped ampersand would have the voice read it out literally.
const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, String.fromCharCode(39))
    .replace(/&apos;/g, String.fromCharCode(39))
    .replace(/&amp;/g, '&');

const MAX_MEM_CACHE = 64;

export class GoogleTTSClient implements TTSClient {
  name = 'google-tts';
  initialized = false;

  controller?: TTSController;
  appService?: AppService | null;

  #voices: TTSVoice[] = FALLBACK_FR_FEMALE.map((v) => ({ ...v }));
  #voicesLoaded = false;
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = FALLBACK_FR_FEMALE[0]!.id;
  #rate = 1.0;
  #pitch = 1.0;

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
    this.initialized = !!getApiKey();
    if (this.initialized) void this.#loadVoices().catch(() => {});
    return this.initialized;
  }

  // Ask Google for every voice it actually offers, so the picker shows the full
  // set and any voice added later appears without a rebuild.
  async #loadVoices() {
    const key = getApiKey();
    if (!key || this.#voicesLoaded) return;
    const resp = await fetch(`${GOOGLE_TTS_VOICES_URL}?key=${encodeURIComponent(key)}`);
    if (!resp.ok) return;
    const data = (await resp.json()) as {
      voices?: { name: string; languageCodes: string[]; ssmlGender?: string }[];
    };
    const all = data.voices ?? [];
    if (!all.length) return;
    const pretty = (name: string) => {
      // "fr-FR-Chirp3-HD-Aoede" -> "Aoede (Chirp 3 HD)"
      const m = name.match(/^[a-z]{2}-[A-Z]{2}-(.+?)-([^-]+)$/);
      if (!m) return name;
      const family = m[1]!.replace('Chirp3-HD', 'Chirp 3 HD').replace(/-/g, ' ');
      return `${m[2]} (${family})`;
    };
    this.#voices = all
      .filter((v) => (v.ssmlGender || '').toUpperCase() === 'FEMALE')
      .map((v) => ({
        id: v.name,
        name: pretty(v.name),
        lang: v.languageCodes[0] || 'en-US',
      }));
    this.#voicesLoaded = true;
  }

  async #synthesize(voiceId: string, rawText: string, signal: AbortSignal): Promise<string> {
    const text = decodeEntities(rawText).trim();
    if (!text) return '';
    const cacheKey = `${voiceId}|${text}`;
    const cached = this.#memCache.get(cacheKey);
    if (cached) return cached;

    const persisted = await readPersistedAudio(voiceId, text);
    if (persisted) return this.#storeInMemory(cacheKey, persisted);

    const key = getApiKey();
    if (!key) throw new Error('Google TTS API key missing');

    const languageCode = voiceId.split('-').slice(0, 2).join('-') || 'fr-FR';
    const audioConfig: Record<string, unknown> = { audioEncoding: 'MP3' };
    // Only send a rate when it differs from normal: some voice families reject
    // an explicit speakingRate, and there is no reason to risk it at 1.0.
    if (this.#rate !== 1.0) {
      audioConfig['speakingRate'] = Math.min(4, Math.max(0.25, this.#rate));
    }

    const resp = await fetch(`${GOOGLE_TTS_SYNTH_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceId },
        audioConfig,
      }),
      signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Google TTS failed (${resp.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { audioContent?: string };
    if (!data.audioContent) throw new Error('Google TTS returned no audio');
    const buffer = base64ToBuffer(data.audioContent);
    if (!isValidAudio(buffer)) throw new Error('Google TTS returned invalid audio');
    await writePersistedAudio(voiceId, text, buffer);
    return this.#storeInMemory(cacheKey, buffer);
  }

  #storeInMemory(cacheKey: string, buffer: ArrayBuffer): string {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
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
      for (const mark of marks.slice(0, 4)) {
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
        console.warn('Google TTS error for mark:', mark.text, message);
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

  async setPitch(pitch: number) {
    this.#pitch = pitch;
  }

  async setVoice(voice: string) {
    this.#currentVoiceId = voice;
  }

  getVoiceIdFromLang = (lang: string): string => {
    const preferred = TTSUtils.getPreferredVoice(this.name, lang);
    if (preferred && this.#voices.some((v) => v.id === preferred)) return preferred;
    const match = this.#voices.find((v) => isSameLang(v.lang, lang));
    return this.#currentVoiceId || match?.id || FALLBACK_FR_FEMALE[0]!.id;
  };

  async getAllVoices(): Promise<TTSVoice[]> {
    await this.#loadVoices().catch(() => {});
    this.#voices.forEach((v) => (v.disabled = !this.initialized));
    return this.#voices;
  }

  async getVoices(lang: string): Promise<TTSVoicesGroup[]> {
    const all = await this.getAllVoices();
    const locale = getUserLocale() || 'fr-FR';
    const filtered = all.filter((v) => isSameLang(v.lang, lang));
    if (!filtered.length) return [];
    return [
      {
        id: 'google-tts',
        name: 'Google (voix féminines)',
        voices: filtered.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale)),
        disabled: !this.initialized,
      },
    ];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  supportsWordBoundaries(): boolean {
    // The REST API returns no word timings. Sentence-level highlighting is
    // always in sync; a synthetic word tracker is not — that lesson cost a month.
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
