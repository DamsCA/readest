import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTS } from 'foliate-js/tts.js';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { TTSGranularity } from '@/services/tts/types';
import { hasLangPart, untranslatedParagraphs } from '@/services/tts/ttsTranslation';
import { FoliateView } from '@/types/view';
import { AppService } from '@/types/system';
import { createRejectFilter } from '@/utils/node';
import { ttsTextWalker } from '@/utils/ttsTextWalker';
import { createTranslationWrapper } from '@/utils/translationDom';

// Reading both languages (the default: each paragraph in English, then in
// French), the voice reads the page, and the reader's translator translates
// what the screen shows. With the screen off nothing is drawn: from the last
// page seen on, the voice went on in English only (17 Oct 2026). The voice now
// asks for the translations itself — against the real foliate TTS and a page
// as the reader leaves it.

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockClient('web'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockClient('edge'));
  }),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue(null),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
    sortVoicesPreferLocaleFunc: vi.fn(() => () => 0),
  },
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));

function mockClient(name: string): TTSClient {
  return {
    name,
    initialized: false,
    init: vi.fn().mockResolvedValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    speak: vi.fn().mockImplementation(async function* (): AsyncGenerator<TTSMessageEvent> {
      yield { code: 'end' };
    }),
    pause: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(undefined),
    setPrimaryLang: vi.fn(),
    setRate: vi.fn().mockResolvedValue(undefined),
    setPitch: vi.fn().mockResolvedValue(undefined),
    setVoice: vi.fn().mockResolvedValue(undefined),
    getAllVoices: vi.fn().mockResolvedValue([]),
    getVoices: vi.fn().mockResolvedValue([]),
    getGranularities: vi.fn().mockReturnValue(['sentence'] as TTSGranularity[]),
    supportsWordBoundaries: vi.fn().mockReturnValue(false),
    getVoiceId: vi.fn().mockReturnValue('voice-1'),
    getSpeakingLang: vi.fn().mockReturnValue('en'),
  };
}

// Mirrors TTSController#createTTSNodeFilter (notably: <br> is rejected).
const ttsNodeFilter = createRejectFilter({
  tags: ['rt', 'canvas', 'br'],
  classes: ['annotationLayer'],
  attributeTokens: [],
  contents: [],
});

const ENGLISH = Array.from({ length: 10 }, (_, i) => `Line ${i} A is here. Line ${i} B is here.`);
const french = (english: string) => english.replaceAll('is here', 'est là');

const translate = (el: HTMLElement) =>
  el.appendChild(
    createTranslationWrapper(el.ownerDocument, french(el.textContent ?? ''), {
      lang: 'fr',
      hidden: false,
      lineBreak: false,
      blockClassName: 'translation-target-block',
    }),
  );

const makePage = (translated = 0) => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>\n${ENGLISH.map((p) => `<p>${p}</p>`).join('\n')}\n</body></html>`,
    'text/html',
  );
  Array.from(doc.querySelectorAll('p'))
    .slice(0, translated)
    .forEach((p) => translate(p as HTMLElement));
  return doc;
};

const makeView = (doc: Document) => {
  const view = {
    renderer: {
      primaryIndex: 0,
      getContents: vi.fn(() => [{ doc, index: 0, overlayer: { remove: vi.fn(), add: vi.fn() } }]),
    },
    book: { sections: [{ createDocument: vi.fn().mockResolvedValue(doc) }] },
    language: { isCJK: false },
    tts: new TTS(doc, ttsTextWalker, ttsNodeFilter, vi.fn(), 'sentence'),
    getCFI: vi.fn().mockReturnValue('cfi'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: vi.fn().mockReturnValue(new Range()) }),
  };
  return view as unknown as FoliateView;
};

// The voice: what it is given to read, until it is stopped.
const listen = (controller: TTSController) => {
  const heard: string[] = [];
  controller.ttsClient.speak = vi.fn(async function* (
    ssml: string,
    signal: AbortSignal,
    preload?: boolean,
  ) {
    if (!preload) heard.push(ssml);
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
  }) as unknown as TTSClient['speak'];
  return heard;
};

const text = (ssml: string | undefined) =>
  (ssml ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface Ask {
  texts: string[];
  now: boolean;
}

const setUp = (doc: Document, translator: (els: HTMLElement[], now: boolean) => void) => {
  const view = makeView(doc);
  const controller = new TTSController({} as AppService, view, false);
  const heard = listen(controller);
  const asked: Ask[] = [];
  controller.ttsLang = 'en';
  controller.bothLanguagesTarget = () => 'fr';
  controller.translateBlocks = async (elements, now) => {
    asked.push({ texts: elements.map((el) => el.textContent ?? ''), now });
    translator(elements, now);
  };
  return { view, controller, heard, asked };
};

describe('what the voice is about to read, not translated yet', () => {
  it('finds the paragraph read now, and the ones after it', () => {
    const doc = makePage(2);
    const tts = new TTS(doc, ttsTextWalker, ttsNodeFilter, vi.fn(), 'sentence');
    tts.start();
    tts.next();
    expect(hasLangPart(tts.resume()!, 'fr')).toBe(true);
    const third = tts.next()!;
    expect(hasLangPart(third, 'fr')).toBe(false);

    const block = doc.createRange();
    block.selectNodeContents(doc.querySelectorAll('p')[2]!);
    const { current, next } = untranslatedParagraphs(doc, block, 6);
    expect(current.map((el) => el.textContent)).toEqual([ENGLISH[2]]);
    expect(next.map((el) => el.textContent)).toEqual(ENGLISH.slice(3, 9));
  });

  it('counts the paragraphs ahead whether translated or not', () => {
    const doc = makePage(5);
    const block = doc.createRange();
    block.selectNodeContents(doc.querySelectorAll('p')[0]!);
    const { current, next } = untranslatedParagraphs(doc, block, 6);
    expect(current).toHaveLength(0);
    // Paragraphs 1-4 are translated; of the six after the first, 5 and 6 are not.
    expect(next.map((el) => el.textContent)).toEqual(ENGLISH.slice(5, 7));
  });
});

describe('reading both languages, the screen off', () => {
  let doc: Document;
  beforeEach(() => {
    doc = makePage();
  });

  it('waits for the paragraph’s translation, then reads both languages', async () => {
    const { view, controller, heard, asked } = setUp(doc, (els, now) => {
      if (now) els.forEach(translate);
    });
    await controller.speak(view.tts!.start()!);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    expect(text(heard[0])).toBe(`${ENGLISH[0]} ${french(ENGLISH[0]!)}`);
    expect(hasLangPart(heard[0]!, 'fr')).toBe(true);
    // The next paragraphs were asked for without waiting; this one, waited for.
    expect(asked).toEqual([
      { texts: ENGLISH.slice(1, 7), now: false },
      { texts: [ENGLISH[0]], now: true },
    ]);
    // The French on the page is the voice's: its sentences are foliate's marks.
    expect(view.tts!.setMark('2')).toBeDefined();
  });

  it('does not wait for a paragraph already translated', async () => {
    doc = makePage(1);
    const { view, controller, heard, asked } = setUp(doc, () => {});
    await controller.speak(view.tts!.start()!);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    expect(text(heard[0])).toBe(`${ENGLISH[0]} ${french(ENGLISH[0]!)}`);
    expect(asked).toEqual([{ texts: ENGLISH.slice(1, 7), now: false }]);
  });

  it('starting mid-paragraph, starts from the same sentence', async () => {
    const { view, controller, heard } = setUp(doc, (els, now) => {
      if (now) els.forEach(translate);
    });
    const p = doc.querySelector('p')!.firstChild!;
    const second = doc.createRange();
    second.setStart(p, ENGLISH[0]!.indexOf('Line 0 B'));
    second.setEnd(p, ENGLISH[0]!.length);
    await controller.speak(view.tts!.from(second)!);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    expect(text(heard[0])).toBe(`Line 0 B is here. ${french(ENGLISH[0]!)}`);
  });

  it('goes on without waiting once the translator has missed twice in a row', async () => {
    const { view, controller, heard, asked } = setUp(doc, () => {});
    const tts = view.tts!;
    await controller.speak(tts.start()!);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    await controller.speak(tts.next()!);
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    await controller.speak(tts.next()!);
    await vi.waitFor(() => expect(heard).toHaveLength(3));
    // Read in English as they are; the third one is not waited for.
    expect(heard.map(text)).toEqual(ENGLISH.slice(0, 3));
    expect(asked.filter((ask) => ask.now).map((ask) => ask.texts)).toEqual([
      [ENGLISH[0]],
      [ENGLISH[1]],
    ]);
  });

  // claire.61 waited up to 8 s, screen off too: the sound stopped, Android
  // closed the app's media session, and the voice never came back (emulator,
  // 17 Oct 2026). With the screen off the voice reads the paragraph as it is.
  it('with the screen off, hardly waits for a translation that is not there', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const { view, controller, heard } = setUp(doc, () => {});
      controller.translateBlocks = (_elements, now) =>
        now ? new Promise<void>(() => {}) : Promise.resolve();
      const started = Date.now();
      await controller.speak(view.tts!.start()!);
      await vi.waitFor(() => expect(heard).toHaveLength(1), { timeout: 1500 });
      expect(Date.now() - started).toBeLessThan(1500);
      expect(text(heard[0])).toBe(ENGLISH[0]);
    } finally {
      hidden.mockRestore();
    }
  });

  it('with the screen on, gives the translation more time', async () => {
    const { view, controller, heard } = setUp(doc, () => {});
    controller.translateBlocks = (_elements, now) =>
      now ? new Promise<void>(() => {}) : Promise.resolve();
    await controller.speak(view.tts!.start()!);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(heard).toHaveLength(0);
    await controller.stop();
  });

  it('leaves a voice reading one language alone', async () => {
    const { view, controller, heard, asked } = setUp(doc, () => {});
    controller.bothLanguagesTarget = () => '';
    await controller.speak(view.tts!.start()!);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    expect(asked).toHaveLength(0);
  });
});
