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

  constructor(controller?: TTSController, appService?: AppService | null) {
    this.controller = controller;
    this.appService = appService;
  }

  async init() {
    // Available when a key is baked into the build (Tauri) or when running on
    // the web platform, where the proxy route holds the key server-side.
    this.initialized = !!getApiKey() || isWebAppPlatform();
    return this.initialized;
  }

  #cacheKey(voiceId: string, text: string) {
    return `${voiceId}:${text}`;
  }

  async #synthesize(voiceId: string, text: string, signal: AbortSignal): Promise<string> {
    const cacheKey = this.#cacheKey(voiceId, text);
    const cached = this.#audioCache.get(cacheKey);
    if (cached) return cached;

    const payload = JSON.stringify({
      text,
      reference_id: voiceId,
      format: 'mp3',
      mp3_bitrate: 128,
    });

    let response: Response;
    if (isTauriAppPlatform()) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
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
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
    // Bound the cache and revoke evicted object URLs. Without this the map grew
    // unbounded over a reading session, leaking every synthesized sentence's
    // blob (a real memory leak on long books).
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
          await this.#synthesize(voiceId, mark.text, signal);
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

    for (const mark of marks) {
      this.controller?.dispatchSpeakMark(mark);
      let abortHandler: null | (() => void) = null;
      try {
        const voiceId = this.getVoiceIdFromLang(mark.language);
        this.#currentVoiceId = voiceId;
        this.#speakingLang = mark.language;
        const audioUrl = await this.#synthesize(voiceId, mark.text, signal);
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
