import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';

// Gemini TTS, via the Gemini API. Two reasons it replaced Cloud Text-to-Speech
// here, both measured rather than assumed:
//
//  1. BILINGUAL. Cloud TTS was queried directly: 2066 voices, ZERO of them
//     multilingual — every voice is locked to one languageCode. These books are
//     English EPUBs narrated in French, so the French carries English names and
//     quotations, and a locale-locked voice mangles them. Gemini voices switch
//     language mid-sentence with no configuration.
//  2. NO INFRASTRUCTURE. An API key is the whole deployment — no GPU, no WSL, no
//     Cloudflare tunnel, no R2 bucket, no watchdog. Those accounted for
//     essentially every outage of the previous month.
//
// It also takes a plain-language style instruction, which is how the narration
// tone is set (see NARRATION_STYLE).
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

const getApiKey = () => process.env['NEXT_PUBLIC_GOOGLE_TTS_API_KEY'] || '';

// Prepended to every sentence. The model follows it without reading it aloud.
const NARRATION_STYLE =
  "Lis ce passage comme une narratrice d'audiobook : voix douce, posée, intime. ";

// Gemini's prebuilt voices are language-independent: the same voice speaks every
// supported language, which is exactly the property Cloud TTS lacked. The API
// exposes no voices.list endpoint for them, so the roster is declared here.
// Female-presenting voices only, per the owner's request.
const GEMINI_FEMALE_VOICES = [
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
];

const DEFAULT_VOICE = 'Kore';

// Persistent audio cache: "generate once, keep forever". Also the cost control —
// re-reading a passage never spends a second token of quota.
const PERSIST_CACHE_NAME = 'gemini-tts-audio-v1';

const hashText = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
};

const persistRequest = (voiceId: string, text: string) =>
  new Request(`https://gemini-tts.local/${encodeURIComponent(voiceId)}/${hashText(text)}`);

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

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Gemini returns raw 24kHz 16-bit mono PCM, which <audio> cannot play. Wrap it
// in a WAV header (44 bytes) so it becomes a normal playable blob.
const pcmToWav = (pcm: Uint8Array, sampleRate = 24000): ArrayBuffer => {
  const out = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(out);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  new Uint8Array(out, 44).set(pcm);
  return out;
};

const isValidAudio = (buffer: ArrayBuffer): boolean => buffer.byteLength > 1024;

// parseSSMLMarks never decodes entities, but the model receives PLAIN text —
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

export class GoogleTTSClient implements TTSClient {
  name = 'google-tts';
  initialized = false;

  controller?: TTSController;
  appService?: AppService | null;

  #voices: TTSVoice[] = GEMINI_FEMALE_VOICES.map((n) => ({
    id: n,
    // Language-neutral label: the same voice speaks French and English.
    name: `${n} (Gemini · bilingue)`,
    lang: 'mul',
  }));
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
    this.initialized = !!getApiKey();
    return this.initialized;
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
    if (!key) throw new Error('Gemini TTS API key missing');

    const resp = await fetch(
      `${GEMINI_BASE}/${GEMINI_TTS_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: NARRATION_STYLE + text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
          },
        }),
        signal,
      },
    );
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Gemini TTS failed (${resp.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error('Gemini TTS returned no audio');
    const buffer = pcmToWav(base64ToBytes(b64));
    if (!isValidAudio(buffer)) throw new Error('Gemini TTS returned invalid audio');
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
        console.warn('Gemini TTS error for mark:', mark.text, message);
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
    // Gemini voices expose no pitch control; accepted for interface parity.
  }

  async setVoice(voice: string) {
    this.#currentVoiceId = voice;
  }

  // Voices are language-independent, so the book's language never restricts the
  // choice — it only decides which stored preference to look up.
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
        id: 'gemini-tts',
        name: 'Gemini — voix féminines bilingues',
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
