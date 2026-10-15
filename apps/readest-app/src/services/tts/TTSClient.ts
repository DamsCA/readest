import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

type TTSMessageCode = 'boundary' | 'error' | 'end';

export interface TTSMessageEvent {
  code: TTSMessageCode;
  message?: string;
  mark?: string;
}

export interface TTSClient {
  name: string;
  initialized: boolean;
  init(): Promise<boolean>;
  shutdown(): Promise<void>;
  speak(ssml: string, signal: AbortSignal, preload?: boolean): AsyncIterable<TTSMessageEvent>;
  pause(): Promise<boolean>;
  resume(): Promise<boolean>;
  stop(): Promise<void>;
  setPrimaryLang(lang: string): void;
  setRate(rate: number): Promise<void>;
  setPitch(pitch: number): Promise<void>;
  setVoice(voice: string): Promise<void>;
  getAllVoices(): Promise<TTSVoice[]>;
  getVoices(lang: string): Promise<TTSVoicesGroup[]>;
  getGranularities(): TTSGranularity[];
  // Whether this client reports word-boundary timings during playback so the
  // controller can highlight word-by-word (and suppress the sentence highlight).
  supportsWordBoundaries(): boolean;
  getVoiceId(): string;
  // The voice this client reads `lang` with: the one picked for that language,
  // else its default for it. Each sentence is read with the voice of its own
  // language, so a translated book has one voice per language.
  getVoiceIdFromLang?(lang: string): string | Promise<string>;
  getSpeakingLang(): string;
  // A new rate applied to the sentence being read, without restarting it.
  setRateLive?(rate: number): void;
  // The reader's volume for one language's voice (0..1), applied at once.
  setLangVolume?(lang: string, volume: number): void;
}
