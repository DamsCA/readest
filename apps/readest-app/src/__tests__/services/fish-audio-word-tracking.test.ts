import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Fish Audio client end to end, minus the network and the audio device:
// it must ask the relay for word timings, then report the spoken word from
// audio.currentTime so the reader can turn the page on that word.

let parsedMarks: Array<{ name: string; text: string; language: string }> = [];

vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: parsedMarks })),
}));
vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => lang),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(() => null),
    sortVoicesPreferLocaleFunc: vi.fn(() => () => 0),
  },
}));
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => '/api',
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
const mockFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));

import { FishAudioTTSClient } from '@/services/tts/FishAudioTTSClient';
import type { TTSController } from '@/services/tts/TTSController';
import type { TTSMessageEvent } from '@/services/tts/TTSClient';

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  playbackRate = 1;
  volume = 1;
  preload = '';
  onended: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  setAttribute() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  load() {}
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  at(seconds: number) {
    this.currentTime = seconds;
    this.dispatchEvent(new Event('timeupdate'));
  }
}

const RELAY = 'https://relay.test';
const MP3 = (() => {
  const bytes = new Uint8Array(2048);
  bytes.set([0x49, 0x44, 0x33]); // "ID3"
  return bytes;
})();
const WORDS = [
  { text: 'Le', start: 0, end: 0.16 },
  { text: 'jour', start: 0.16, end: 0.48 },
  { text: 'touchait', start: 0.48, end: 0.8 },
  { text: 'à', start: 0.8, end: 0.88 },
  { text: 'sa', start: 0.88, end: 1.12 },
  { text: 'fin', start: 1.12, end: 1.36 },
];
const timedResponse = () =>
  new Response(
    `data: ${JSON.stringify({
      audio_base64: Buffer.from(MP3).toString('base64'),
      chunk_seq: 0,
      chunk_audio_offset_sec: 0,
      alignment: { audio_duration: 1.4, segments: WORDS },
    })}\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

let rafQueue: FrameRequestCallback[] = [];
const runFrames = () => {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb(0);
};

const makeController = () =>
  ({
    dispatchSpeakMark: vi.fn(),
    prepareSpeakWords: vi.fn(() => true),
    dispatchSpeakWord: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as TTSController & {
    dispatchSpeakMark: ReturnType<typeof vi.fn>;
    prepareSpeakWords: ReturnType<typeof vi.fn>;
    dispatchSpeakWord: ReturnType<typeof vi.fn>;
  };

const startSpeaking = async (client: FishAudioTTSClient) => {
  const gen = client.speak('<speak/>', new AbortController().signal);
  const first = await gen.next();
  expect((first.value as TTSMessageEvent).code).toBe('boundary');
  // Resumes synchronously up to `await playOnce(...)`: tracking is armed and
  // play() has been called by the time next() returns its promise.
  const ended = gen.next();
  return { gen, ended, audio: FakeAudio.instances[0]! };
};

describe('Fish Audio word tracking', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    rafQueue = [];
    mockFetch.mockReset();
    parsedMarks = [{ name: '0', text: 'Le jour touchait à sa fin.', language: 'fr' }];
    process.env['NEXT_PUBLIC_FISH_RELAY_URL'] = RELAY;
    process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] = 'token';
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:clip-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('asks the relay for timings and reports each spoken word from the playhead', async () => {
    mockFetch.mockImplementation(async () => timedResponse());
    const controller = makeController();
    const client = new FishAudioTTSClient(controller);
    await client.init();

    const { gen, ended, audio } = await startSpeaking(client);

    expect(mockFetch.mock.calls[0]![0]).toBe(`${RELAY}/v1/tts/stream/with-timestamp`);
    expect(controller.prepareSpeakWords).toHaveBeenCalledWith(WORDS.map((w) => w.text));

    audio.at(0.5); // inside "touchait"
    expect(controller.dispatchSpeakWord).toHaveBeenLastCalledWith(2);
    audio.at(1.2); // "fin"
    expect(controller.dispatchSpeakWord).toHaveBeenLastCalledWith(5);
    const reported = controller.dispatchSpeakWord.mock.calls.length;
    audio.at(1.3); // same word: not reported twice
    expect(controller.dispatchSpeakWord).toHaveBeenCalledTimes(reported);

    audio.paused = true;
    audio.ended = true;
    audio.onended?.();
    expect(((await ended).value as TTSMessageEvent).code).toBe('end');

    // The clip is over: a late timeupdate must not report its words again.
    controller.dispatchSpeakWord.mockClear();
    audio.at(0.2);
    expect(controller.dispatchSpeakWord).not.toHaveBeenCalled();
    await gen.next();
  });

  it('keeps following through the frame loop, which a pause stops and resume restarts', async () => {
    mockFetch.mockImplementation(async () => timedResponse());
    const controller = makeController();
    const client = new FishAudioTTSClient(controller);
    await client.init();

    const { ended, audio } = await startSpeaking(client);
    expect(rafQueue.length).toBe(1);
    audio.currentTime = 0.9; // "sa", seen by the frame loop alone
    runFrames();
    expect(controller.dispatchSpeakWord).toHaveBeenLastCalledWith(4);
    expect(rafQueue.length).toBe(1);

    await client.pause();
    runFrames();
    expect(rafQueue.length).toBe(0);

    await client.resume();
    expect(rafQueue.length).toBe(1);
    audio.currentTime = 1.2;
    runFrames();
    expect(controller.dispatchSpeakWord).toHaveBeenLastCalledWith(5);

    audio.ended = true;
    audio.onended?.();
    await ended;
  });

  it('falls back to the plain route once when the relay predates the timed one', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith('/with-timestamp')
        ? new Response('{"error":"not found"}', { status: 404 })
        : new Response(MP3, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
    );
    const controller = makeController();
    const client = new FishAudioTTSClient(controller);
    await client.init();

    const { gen, ended, audio } = await startSpeaking(client);
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      `${RELAY}/v1/tts/stream/with-timestamp`,
      `${RELAY}/v1/tts`,
    ]);
    // No timings: the controller still gets called (it draws the sentence
    // highlight that word mode suppressed), and no word is ever reported.
    expect(controller.prepareSpeakWords).toHaveBeenCalledWith([]);
    audio.at(0.5);
    expect(controller.dispatchSpeakWord).not.toHaveBeenCalled();
    audio.ended = true;
    audio.onended?.();
    await ended;
    await gen.next();

    // Remembered: the next sentence goes straight to the plain route.
    parsedMarks = [{ name: '1', text: 'Il rentra chez lui.', language: 'fr' }];
    mockFetch.mockClear();
    const again = await startSpeaking(client);
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([`${RELAY}/v1/tts`]);
    again.audio.ended = true;
    again.audio.onended?.();
    await again.ended;
  });
});
