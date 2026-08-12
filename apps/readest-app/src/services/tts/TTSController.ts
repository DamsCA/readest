import { FoliateView } from '@/types/view';
import { AppService } from '@/types/system';
import { filterSSMLWithLang, parseSSMLMarks, prefetchSentenceTexts } from '@/utils/ssml';
import { blockSourceText, walkTextNodes } from '@/utils/walk';
import { Overlayer } from 'foliate-js/overlayer.js';
import {
  TTSGranularity,
  TTSHighlightGranularity,
  TTSHighlightOptions,
  TTSMark,
  TTSVoice,
} from './types';
import { createRejectFilter } from '@/utils/node';
import { WebSpeechClient } from './WebSpeechClient';
import { NativeTTSClient } from './NativeTTSClient';
import { EdgeTTSClient } from './EdgeTTSClient';
import { FishAudioTTSClient } from './FishAudioTTSClient';
import { TTSUtils } from './TTSUtils';
import { TTSClient } from './TTSClient';
import { isSameLang, isValidLang } from '@/utils/lang';
import {
  computeWordOffsets,
  getTextSubRange,
  rangeTextExcludingInert,
  TTSWordOffset,
} from './wordHighlight';

// App-wide monotonic sequence for 'tts-position' events. A fresh TTSController
// is constructed per `tts-speak`, so a per-instance counter would restart at 0
// and consumers (paragraph mode, RSVP) holding `lastSequenceSeen` from a prior
// session would drop the new session's early positions until they exceeded the
// old count. A module-level counter keeps the sequence strictly increasing
// across sessions.
let ttsPositionSequence = 0;

// Native TTS (Android System TTS / iOS) can report a terminal 'error' for an
// utterance it cannot synthesize offline — typically a specific unsupported
// character, hit characteristically on the first utterance after a chapter
// boundary even with a local/offline voice (online the engine often
// network-falls-back, which is why it only breaks offline). #speak only
// auto-advances on 'end', so without handling, a single such error dead-ends
// playback and wedges the controls in 'playing'. Re-speaking the same text
// would just fail again, so we skip the bad chunk and advance — bounding
// consecutive failures so a wholly-unusable engine still stops gracefully
// instead of silently racing to the end of the book. See #4613, #4408.
const TTS_NATIVE_SPEAK_MAX_CONSECUTIVE_ERRORS = 5;
// Bound how many consecutive empty/mark-less paragraphs we auto-skip. In
// translation mode, paragraphs not yet translated filter down to an empty
// utterance; without a bound, playback silently fast-forwards through the whole
// book. After this many skips in a row we stop so the user isn't stranded in
// silence far from where they were.
const TTS_MAX_CONSECUTIVE_EMPTY_SKIPS = 30;
// In translation mode, wait-and-retry the current paragraph this many times
// (a paragraph filters to empty until its async translation is injected) before
// giving up and advancing. The first retry also drives the view to the
// paragraph (see #speak) so the viewport-driven translator can see it; DeepL
// then needs a couple of seconds, so the budget must cover a full round trip.
const TTS_MAX_EMPTY_RETRIES = 8;
const TTS_EMPTY_RETRY_DELAY_MS = 800;

type TTSState =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'stop-paused'
  | 'backward-paused'
  | 'forward-paused'
  | 'setrate-paused'
  | 'setvoice-paused';

const HIGHLIGHT_KEY = 'tts-highlight';

export class TTSController extends EventTarget {
  appService: AppService | null = null;
  view: FoliateView;
  isAuthenticated: boolean = false;
  preprocessCallback?: (ssml: string) => Promise<string>;
  onSectionChange?: (sectionIndex: number) => Promise<void>;
  // Translation-mode dependency injected by useTTSControl: batch-translate raw
  // paragraph texts through the SAME provider/cache the reader's injector uses,
  // returning the final (polished) target-language strings — or null when
  // translation is disabled/unavailable. Used to prepare the NEXT chapter
  // (translation cache warm + audio pre-generation) while the current one is
  // still playing, so the chapter flip is seamless.
  prefetchTranslations?: (texts: string[]) => Promise<(string | null)[] | null>;
  #nossmlCnt: number = 0;
  // Consecutive native-TTS utterances that ended in a terminal 'error' without
  // a successful 'end' in between. Reset on success; caps skip-on-error so a
  // wholly-unusable engine stops instead of racing to the book end. See #4613.
  #consecutiveSpeakErrors: number = 0;
  #consecutiveEmptySkips: number = 0;
  #emptyRetries: number = 0;
  #currentSpeakAbortController: AbortController | null = null;
  #currentSpeakPromise: Promise<void> | null = null;

  #ttsSectionIndex: number = -1;
  // Cross-chapter prefetch state. The abort controller is session-scoped
  // (aborted in shutdown, NOT by per-paragraph stop()), because banked audio is
  // content-addressed — a prefetch that outlives navigation is still value.
  #prefetchAbortController = new AbortController();
  #prefetchedNextSection: number = -1;
  // Word-level highlight state for the currently spoken chunk. Armed by a
  // successful dispatchSpeakMark, populated by prepareSpeakWords when a TTS
  // client has word-boundary metadata for the chunk.
  #speakWordsArmed = false;
  #speakWordBaseRange: Range | null = null;
  #speakWordOffsets: (TTSWordOffset | null)[] = [];
  #speakWordRanges: (Range | null | undefined)[] = [];
  #suppressMarkHighlight = false;
  // True while the current chunk is highlighted word-by-word, with the most
  // recently highlighted word range. Lets re-highlights (e.g. on page relocate)
  // re-apply the word instead of redrawing the whole sentence over it.
  #wordHighlightActive = false;
  #lastSpeakWordRange: Range | null = null;
  // User-chosen highlight granularity. 'sentence' (default) keeps the highlight
  // on the whole spoken sentence — always in sync. 'word' highlights word-by-word
  // when the active client reports word boundaries, but for the Claire/Fish
  // client those boundaries are SYNTHETIC (interpolated from audio position, no
  // real timings), so it drifts ahead of the voice. Must match
  // DEFAULT_VIEW_SETTINGS: a mismatched initializer silently re-armed word mode.
  #highlightGranularity: TTSHighlightGranularity = 'sentence';

  state: TTSState = 'stopped';
  ttsLang: string = '';
  ttsRate: number = 1.0;
  ttsClient: TTSClient;
  ttsWebClient: TTSClient;
  ttsEdgeClient: TTSClient;
  ttsFishClient: TTSClient;
  ttsNativeClient: TTSClient | null = null;
  ttsWebVoices: TTSVoice[] = [];
  ttsEdgeVoices: TTSVoice[] = [];
  ttsFishVoices: TTSVoice[] = [];
  ttsNativeVoices: TTSVoice[] = [];
  ttsTargetLang: string = '';

  options: TTSHighlightOptions = { style: 'highlight', color: 'gray' };

  constructor(
    appService: AppService | null,
    view: FoliateView,
    isAuthenticated: boolean = false,
    preprocessCallback?: (ssml: string) => Promise<string>,
    onSectionChange?: (sectionIndex: number) => Promise<void>,
  ) {
    super();
    this.ttsWebClient = new WebSpeechClient(this);
    this.ttsEdgeClient = new EdgeTTSClient(this, appService);
    this.ttsFishClient = new FishAudioTTSClient(this, appService);
    // Native TTS is backed by Android TextToSpeech and iOS AVSpeechSynthesizer.
    // TODO: implement native TTS client for desktop platforms.
    if (appService?.isAndroidApp || appService?.isIOSApp) {
      this.ttsNativeClient = new NativeTTSClient(this);
    }
    this.ttsClient = this.ttsWebClient;
    this.appService = appService;
    this.view = view;
    this.isAuthenticated = isAuthenticated;
    this.preprocessCallback = preprocessCallback;
    this.onSectionChange = onSectionChange;
  }

  async init() {
    const availableClients = [];
    // Fish Audio is the preferred default client (reliable paid-grade API with
    // the curated "Claire" voice), so it leads the list and becomes the active
    // client unless the user has explicitly chosen another one.
    if (await this.ttsFishClient.init()) {
      availableClients.push(this.ttsFishClient);
      // (ttsFishVoices is read once at the end of init; the duplicate early read
      // that used to be here only widened the window for a concurrent shutdown
      // to invalidate it.)
    }
    if (await this.ttsEdgeClient.init()) {
      availableClients.push(this.ttsEdgeClient);
    }
    if (this.ttsNativeClient && (await this.ttsNativeClient.init())) {
      availableClients.push(this.ttsNativeClient);
      this.ttsNativeVoices = await this.ttsNativeClient.getAllVoices();
    }
    if (await this.ttsWebClient.init()) {
      availableClients.push(this.ttsWebClient);
    }
    this.ttsClient = availableClients[0] || this.ttsWebClient;
    const preferredClientName = TTSUtils.getPreferredClient();
    if (preferredClientName) {
      const preferredClient = availableClients.find(
        (client) => client.name === preferredClientName,
      );
      if (preferredClient) {
        this.ttsClient = preferredClient;
      }
    }
    this.ttsWebVoices = await this.ttsWebClient.getAllVoices();
    this.ttsEdgeVoices = await this.ttsEdgeClient.getAllVoices();
    this.ttsFishVoices = await this.ttsFishClient.getAllVoices();
  }

  #getPrimaryContent() {
    const contents = this.view.renderer.getContents();
    const primaryIndex = this.view.renderer.primaryIndex;
    return (contents.find((x) => x.index === primaryIndex) ?? contents[0]) as
      | {
          doc: Document;
          index?: number;
          overlayer?: Overlayer;
        }
      | undefined;
  }

  #getHighlighter() {
    return (range: Range) => {
      // Suppress the sentence highlight that foliate's setMark draws when the
      // active client highlights word-by-word. The flag is only set around the
      // synchronous setMark call, so word draws (dispatchSpeakWord) and paused
      // navigation still highlight normally.
      if (this.#suppressMarkHighlight) return;
      const content = this.#getPrimaryContent();
      if (!content) return;
      const { doc, index, overlayer } = content;
      if (!doc || index === undefined || index !== this.#ttsSectionIndex) {
        return;
      }
      try {
        const cfi = this.view.getCFI(index, range);
        const visibleRange = this.view.resolveCFI(cfi).anchor(doc);
        const { style, color } = this.options;
        overlayer?.remove(HIGHLIGHT_KEY);
        overlayer?.add(HIGHLIGHT_KEY, visibleRange, Overlayer[style], { color });
      } catch (e) {
        console.error('Failed to highlight range', e);
      }
    };
  }

  #clearHighlighter() {
    const content = this.#getPrimaryContent();
    const overlayer = content?.overlayer as Overlayer | undefined;
    overlayer?.remove(HIGHLIGHT_KEY);
  }

  updateHighlightOptions(options: TTSHighlightOptions) {
    this.options.style = options.style;
    this.options.color = options.color;
  }

  setHighlightGranularity(granularity: TTSHighlightGranularity) {
    this.#highlightGranularity = granularity;
  }

  async initViewTTS(index?: number) {
    if (this.#ttsSectionIndex === -1) {
      const fromSectionIndex = (index || this.#getPrimaryContent()?.index) ?? 0;
      await this.#initTTSForSection(fromSectionIndex);
    }
  }

  async #initTTSForSection(sectionIndex: number): Promise<boolean> {
    const sections = this.view.book.sections;
    if (!sections || sectionIndex < 0 || sectionIndex >= sections.length) {
      return false;
    }

    const section = sections[sectionIndex];
    if (!section?.createDocument) {
      return false;
    }

    this.#ttsSectionIndex = sectionIndex;

    const currentSection = this.#getPrimaryContent();
    if (currentSection?.index !== sectionIndex) {
      await this.onSectionChange?.(sectionIndex);
    }

    let doc: Document;
    // Re-check the RENDERED content AFTER onSectionChange navigated the view:
    // binding to the rendered doc (not a detached background copy) is what lets
    // the async translator's injections reach this TTS instance — a background
    // doc never receives the French, so chapter flips either leaked the source
    // language or starved into silence.
    const renderedSection = this.#getPrimaryContent();
    if (renderedSection?.index === sectionIndex && renderedSection?.doc) {
      doc = renderedSection.doc;
    } else {
      doc = await section.createDocument();
      const html = doc.querySelector('html');
      const lang = html?.getAttribute('lang') || html?.getAttribute('xml:lang') || '';
      // Never stamp the TARGET language onto a source-language document: if
      // ttsLang got resolved to the translation language, stamping it here made
      // filterSSMLWithLang treat the whole English chapter as French and read
      // the source aloud ("English at chapter change").
      if (
        html &&
        !isValidLang(lang) &&
        this.ttsLang &&
        !(this.ttsTargetLang && isSameLang(this.ttsLang, this.ttsTargetLang))
      ) {
        html.setAttribute('lang', this.ttsLang);
        html.setAttribute('xml:lang', this.ttsLang);
      }
    }

    if (this.view.tts && this.view.tts.doc === doc) {
      return true;
    }

    const { TTS } = await import('foliate-js/tts.js');
    const { textWalker } = await import('foliate-js/text-walker.js');
    let granularity: TTSGranularity = this.view.language.isCJK ? 'sentence' : 'word';
    const supportedGranularities = this.ttsClient.getGranularities();
    if (!supportedGranularities.includes(granularity)) {
      granularity = supportedGranularities[0]!;
    }

    this.view.tts = new TTS(
      doc,
      textWalker,
      this.#createTTSNodeFilter(),
      this.#getHighlighter(),
      granularity,
    );
    console.log(`[TTS] Initialized TTS for section ${sectionIndex}`);

    return true;
  }

  #createTTSNodeFilter() {
    return createRejectFilter({
      tags: ['rt', 'canvas', 'br'],
      // Footnotes/endnotes are hidden in the rendered page (see the
      // `.epubtype-footnote`/`aside[epub|type]` rules in getPageLayoutStyles);
      // skip them in TTS too, including for background sections whose
      // documents are loaded without those styles.
      classes: [
        'annotationLayer',
        'epubtype-footnote',
        'duokan-footnote-content',
        'duokan-footnote-item',
      ],
      attributeTokens: [
        {
          tag: 'aside',
          attribute: 'epub:type',
          tokens: ['footnote', 'endnote', 'note', 'rearnote'],
        },
      ],
      contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
    });
  }

  // Prepare the NEXT chapter while the current one is still playing, so the
  // flip is seamless: warm the translation cache for its opening paragraphs
  // (the reader's injector then cache-hits instantly on page turn) and
  // pre-generate their audio at low priority (banked in memory + R2). Runs on
  // a detached background document — never touches the live view or view.tts.
  async #prefetchNextSection() {
    const nextIndex = this.#ttsSectionIndex + 1;
    if (this.#prefetchedNextSection === nextIndex) return;
    const sections = this.view.book.sections;
    if (!sections || nextIndex >= sections.length) return;
    const section = sections[nextIndex];
    if (!section?.createDocument) return;
    this.#prefetchedNextSection = nextIndex;

    const signal = this.#prefetchAbortController.signal;
    try {
      const doc = await section.createDocument();
      if (signal.aborted) return;
      const html = doc.querySelector('html');
      const docLang = html?.getAttribute('lang') || html?.getAttribute('xml:lang') || '';
      if (
        html &&
        !isValidLang(docLang) &&
        this.ttsLang &&
        !(this.ttsTargetLang && isSameLang(this.ttsLang, this.ttsTargetLang))
      ) {
        html.setAttribute('lang', this.ttsLang);
        html.setAttribute('xml:lang', this.ttsLang);
      }

      if (this.ttsTargetLang && this.prefetchTranslations) {
        // Translation mode. Collect paragraph texts exactly as the reader's
        // translator does (same element walk, same normalization), so the warm
        // shares cache keys with the injection that happens after the flip.
        if (!doc.body) return;
        const elements = walkTextNodes(doc.body as HTMLElement, ['pre', 'code', 'math']);
        const texts: string[] = [];
        for (const el of elements) {
          // Same helper as the reader's injector. If these two source strings
          // differ, the translations differ, the audio keys differ, and every
          // byte pre-generated here is thrown away at playback.
          const text = blockSourceText(el);
          if (text) texts.push(text);
          if (texts.length >= 12) break;
        }
        if (texts.length === 0) return;
        const translated = await this.prefetchTranslations(texts);
        if (signal.aborted || !translated) return;

        // Pre-generate audio for the sentences exactly as foliate will emit
        // them at playback time (byte-identical cache keys). Low priority via
        // the preload path — fills GPU idle time, never delays live playback.
        const blockLang =
          (html?.getAttribute('lang') || this.ttsLang || 'en').split('-')[0] || 'en';
        const sentences = translated
          .filter((t): t is string => !!t)
          .flatMap((t) => prefetchSentenceTexts(t, blockLang))
          .slice(0, 40);
        for (let i = 0; i < sentences.length; i += 4) {
          if (signal.aborted) return;
          const chunk = sentences.slice(i, i + 4);
          const body = chunk.map((s, j) => `<mark name="pf${i + j}"/>${s}`).join('');
          const ssml = `<speak xml:lang="${this.ttsTargetLang}">${body}</speak>`;
          await this.preloadSSML(ssml, signal);
        }
      }
      // The source-language prefetch branch that used to live here is DELETED.
      // It was gated on `!this.ttsTargetLang`, but that field is transiently ''
      // (it is only written inside an `if (ssml)` in useTTSControl, and reset to
      // '' whenever getTTSTargetLang() momentarily returns null) while this
      // fire-and-forget prefetch reads it much later. In translation mode it
      // therefore fired anyway and banked ENGLISH audio that playback — which
      // always goes through filterSSMLWithLang — can never look up: pure wasted
      // GPU, generated serially right at the chapter boundary, queued ahead of
      // the live French request. That is what pushed the real chapter opening
      // past its request timeout. In genuine source-language mode
      // preloadNextSSML already banks the runway.
      console.log('[TTS] prefetched next section', nextIndex);
    } catch (err) {
      // Best-effort: allow a later retry for this section.
      this.#prefetchedNextSection = -1;
      console.warn('[TTS] next-section prefetch failed', err);
    }
  }

  async #initTTSForNextSection(): Promise<boolean> {
    const nextIndex = this.#ttsSectionIndex + 1;
    const sections = this.view.book.sections;

    if (!sections || nextIndex >= sections.length) {
      return false;
    }

    return await this.#initTTSForSection(nextIndex);
  }

  async #initTTSForPrevSection(): Promise<boolean> {
    const prevIndex = this.#ttsSectionIndex - 1;

    if (prevIndex < 0) {
      return false;
    }

    return await this.#initTTSForSection(prevIndex);
  }

  async #handleNavigationWithSSML(ssml: string | undefined, isPlaying: boolean) {
    if (isPlaying) {
      this.#speak(ssml);
    } else {
      if (ssml) {
        const { marks } = parseSSMLMarks(ssml);
        if (marks.length > 0) {
          this.dispatchSpeakMark(marks[0]);
        }
      }
    }
  }

  async #handleNavigationWithoutSSML(
    initSection: () => Promise<boolean>,
    isPlaying: boolean,
    toEnd = false,
  ) {
    if (!(await initSection())) {
      await this.stop();
      return;
    }
    let ssml = this.view.tts?.start();
    if (toEnd) {
      // Backward across a chapter boundary: seek to the LAST block of the
      // freshly-initialized previous section (its last sentence), not its first.
      // next() with no paused flag just returns the block's SSML and advances the
      // iterator without speaking/highlighting, so walking it is side-effect free.
      let next = this.view.tts?.next();
      while (next) {
        ssml = next;
        next = this.view.tts?.next();
      }
    }
    if (isPlaying) {
      this.#speak(ssml);
    } else if (ssml) {
      const { marks } = parseSSMLMarks(ssml);
      if (marks.length > 0) this.dispatchSpeakMark(marks[0]);
    }
  }

  async preloadSSML(ssml: string | undefined, signal: AbortSignal) {
    if (!ssml) return;
    const iter = await this.ttsClient.speak(ssml, signal, true);
    for await (const _ of iter);
  }

  // Look far ahead so idle moments (the reader pausing to think, a long sentence
  // playing) are spent banking upcoming audio to R2. On a modest GPU generation
  // is ~real-time, so a deep queue is what smooths first-time reads. These run at
  // low priority, so they never delay the sentence being heard.
  // count=4 (was 10): each next()/prev() re-clones + re-segments a block
  // SYNCHRONOUSLY, so 10 meant 21 fragment rebuilds on the main thread at every
  // paragraph advance — landing in the same task as the transition and starving
  // both the audio 'ended' handler and the highlight. 4 still banks a runway.
  async preloadNextSSML(count: number = 4) {
    const tts = this.view.tts;
    if (!tts) return;

    // Gather all next SSMLs and rewind synchronously to avoid a race condition:
    // tts.next() replaces TTS.#ranges (used by setMark() during playback).
    // If async gaps exist between next()/prev() calls, a concurrent #speak()
    // can dispatch marks against the wrong #ranges, causing incorrect highlights
    // and accidental page turns.
    const rawSsmls: string[] = [];
    for (let i = 0; i < count; i++) {
      const ssml = tts.next();
      if (!ssml) break;
      rawSsmls.push(ssml);
    }
    for (let i = 0; i < rawSsmls.length; i++) {
      tts.prev();
    }
    // Fewer than `count` paragraphs left in this section: the chapter boundary
    // is near. Prepare the next chapter now (translation warm + audio bank) so
    // the flip is seamless. Fire-and-forget; internally deduped per section.
    if (rawSsmls.length < count) {
      void this.#prefetchNextSection();
    }

    const ssmls: string[] = [];
    for (const raw of rawSsmls) {
      const ssml = await this.#preprocessSSML(raw);
      if (!ssml) break;
      ssmls.push(ssml);
    }
    // Tie preloads to the current speak session so navigating/stopping cancels
    // in-flight preloads instead of leaving uncancellable requests running (and,
    // for Fish, creating blob URLs) for a position the user already left.
    // SEQUENTIAL on purpose: firing all paragraphs concurrently let the server
    // generate them in arbitrary wake-up order, so the audio needed NEXT could
    // wait behind paragraph 9. Playback-order banking removes those stalls.
    const preloadSignal = this.#currentSpeakAbortController?.signal ?? new AbortController().signal;
    for (const ssml of ssmls) {
      if (preloadSignal.aborted) break;
      await this.preloadSSML(ssml, preloadSignal);
    }
  }

  // NOTE: the idle bank-ahead loop (#bankAhead + startIdleBanking) was REMOVED.
  // Every 9s while paused it re-walked the chapter with foliate's iterator —
  // each next()/prev() re-clones and re-segments a block synchronously, so a
  // tick froze the main thread for hundreds of ms, delaying the audio 'ended'
  // handler and the highlight. Once its cursor passed the block count it banked
  // nothing at all while still paying the full cost. preloadNextSSML still
  // banks the upcoming paragraphs during playback, which is the runway that
  // actually matters.

  async #preprocessSSML(ssml?: string) {
    if (!ssml) return;
    ssml = ssml
      .replace(/<emphasis[^>]*>([^<]+)<\/emphasis>/g, '$1')
      .replace(/[–—]/g, ',')
      .replace(/<break\b[^>]*\/?>/g, ' ')
      .replace(/\.{3,}/g, '   ')
      .replace(/……/g, '  ')
      .replace(/\*/g, ' ')
      .replace(/·/g, ' ');

    if (this.ttsTargetLang) {
      ssml = filterSSMLWithLang(ssml, this.ttsTargetLang);
    }

    if (this.preprocessCallback) {
      ssml = await this.preprocessCallback(ssml);
    }

    return ssml;
  }

  async #speak(ssml: string | undefined | Promise<string>, oneTime = false) {
    await this.stop();
    // Capture our own controller locally. The finally below must abort/clear
    // THIS one, not the instance field — which a newer #speak may already have
    // replaced. Otherwise an interrupted speak's late finally would abort the
    // fresh playback and strand the transport in 'playing'.
    const controller = new AbortController();
    this.#currentSpeakAbortController = controller;
    const { signal } = controller;

    this.#currentSpeakPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('[TTS] speak');
        this.state = 'playing';

        signal.addEventListener('abort', () => {
          resolve();
        });

        // Keep the RAW (unfiltered) SSML: in translation mode its source-language
        // marks are the only way to locate this paragraph in the view while the
        // translation hasn't been injected yet (the filtered SSML is empty then).
        const rawSsml = await ssml;
        ssml = await this.#preprocessSSML(rawSsml);
        if (!ssml) {
          this.#nossmlCnt++;
          // FIXME: in case we are at the end of the book, need a better way to handle this
          if (this.#nossmlCnt < 10 && this.state === 'playing' && !oneTime) {
            resolve();
            if (await this.#initTTSForNextSection()) {
              // Speak the new section from its start. Previously this called
              // forward() (tts.next()), which advances PAST the first sentence
              // of the freshly-inited section — dropping the chapter's opening
              // line. Mirrors #handleNavigationWithoutSSML.
              await this.#speak(this.view.tts?.start());
            } else {
              await this.stop();
            }
          }
          console.log('[TTS] no SSML, skipping for', this.#nossmlCnt);
          return;
        } else {
          this.#nossmlCnt = 0;
        }

        const { plainText, marks } = parseSSMLMarks(ssml);
        if (!oneTime) {
          if (!plainText || marks.length === 0) {
            resolve();
            // Nothing translatable in this block at all (scene divider, <pre>,
            // punctuation-only). Waiting on a translation that will never come
            // burned ~5s of dead air per block AND counted toward the skip cap.
            // Advance immediately instead.
            const { marks: srcMarks } = parseSSMLMarks(rawSsml ?? '');
            if (this.ttsTargetLang && srcMarks.length === 0) {
              this.#emptyRetries = 0;
              if (signal.aborted) return;
              return await this.forward();
            }
            // Translation mode: an empty utterance almost always means this
            // paragraph isn't translated YET. Translate it ourselves and speak
            // the result directly rather than waiting on the DOM injector.
            if (this.ttsTargetLang && this.#emptyRetries < TTS_MAX_EMPTY_RETRIES) {
              // CRITICAL at chapter boundaries: the translator only translates
              // paragraphs VISIBLE in the view. Right after a section change the
              // view may still sit on the old chapter, so the translation would
              // never arrive and playback died here (stopped dead, no recovery).
              // Dispatch the paragraph's SOURCE mark to drive the view to this
              // position (the cross-section path in handleHighlightMark forces
              // the page turn) — the paragraph becomes visible, the translator
              // picks it up, and the retry below then finds the French.
              if (this.#emptyRetries === 0 && rawSsml) {
                try {
                  const rawMarks = srcMarks;
                  if (rawMarks.length > 0) this.dispatchSpeakMark(rawMarks[0]);
                  // Deterministic: translate THIS paragraph now through the same
                  // provider/cache the injector uses, then SPEAK THE RESULT
                  // DIRECTLY. Merely warming the cache and waiting for the DOM
                  // injector cost ~5.4s of dead air per paragraph, and when the
                  // injector never ran for it (translation equals the source, or
                  // the viewport observer never reached it) the paragraph was
                  // dropped and never spoken at all. Segmented with
                  // prefetchSentenceTexts so audio cache keys stay byte-identical
                  // to the banked ones.
                  if (this.prefetchTranslations && rawMarks.length > 0) {
                    const srcText = rawMarks
                      .map((m) => m.text)
                      .join(' ')
                      .replaceAll('\n', '')
                      // Collapse runs: parseSSMLMarks keeps each mark's TRAILING
                      // space, so join(' ') inserted a second one — a different
                      // translation-cache key than the injector's el.textContent,
                      // costing a duplicate DeepL round trip on every rescue.
                      .replace(/\s+/g, ' ')
                      .trim();
                    if (srcText) {
                      const translated = await this.prefetchTranslations([srcText]).catch(
                        () => null,
                      );
                      const french = translated?.[0];
                      if (french && !signal.aborted && this.state === 'playing') {
                        const blockLang = (this.ttsLang || 'en').split('-')[0] || 'en';
                        const sentences = prefetchSentenceTexts(french, blockLang);
                        if (sentences.length > 0) {
                          // CLAMP to a real mark name. French usually splits into
                          // MORE sentences than the English had marks, and an
                          // invented `tr${j}` name doesn't exist in foliate's
                          // ranges — setMark() returns undefined and the
                          // highlight freezes on sentence 1 while the voice reads
                          // on. Reusing the last real name degrades the highlight
                          // to paragraph granularity instead of killing it.
                          const body = sentences
                            .map(
                              (s, j) =>
                                `<mark name="${rawMarks[Math.min(j, rawMarks.length - 1)]!.name}"/>${s}`,
                            )
                            .join('');
                          this.#emptyRetries = 0;
                          this.#consecutiveEmptySkips = 0;
                          return await this.#speak(
                            `<speak xml:lang="${this.ttsTargetLang}">${body}</speak>`,
                          );
                        }
                      }
                    }
                  }
                } catch {
                  // Best-effort; the retry ladder below still runs.
                }
              }
              this.#emptyRetries++;
              // First retries come fast: with the next-chapter prefetch warming
              // the translation cache, injection after a page flip takes ~100ms
              // — a long first wait would be dead air. Later retries back off to
              // cover a real (cold) DeepL round trip.
              const delay = this.#emptyRetries <= 2 ? 300 : TTS_EMPTY_RETRY_DELAY_MS;
              await new Promise((r) => setTimeout(r, delay));
              // A newer speak session may have started while we slept (user
              // pressed forward/play) — our signal is aborted then; don't fight it.
              if (!signal.aborted && this.state === 'playing') {
                return await this.#speak(this.view.tts?.resume());
              }
              return;
            }
            this.#emptyRetries = 0;
            // Bound consecutive skips so a lagging translation (untranslated
            // paragraphs → empty utterances) can't silently race to the book end.
            this.#consecutiveEmptySkips++;
            if (this.#consecutiveEmptySkips > TTS_MAX_CONSECUTIVE_EMPTY_SKIPS) {
              this.#consecutiveEmptySkips = 0;
              console.warn('[TTS] too many empty paragraphs in a row, stopping');
              return await this.stop();
            }
            if (signal.aborted) return; // a newer session took over while we waited
            return await this.forward();
          } else {
            this.#emptyRetries = 0;
            this.#consecutiveEmptySkips = 0;
            // NO optimistic dispatchSpeakMark here. It highlighted (and turned
            // the page to) the paragraph's first sentence BEFORE any audio was
            // synthesized — seconds ahead of the voice on a cold paragraph,
            // which is exactly the "highlight races ahead / it skipped
            // sentences" report. Every client dispatches its own mark at the
            // moment its audio actually starts.
          }
          // Fire-and-forget: awaiting here blocked the FIRST sound of every
          // cold paragraph until several sentences were fully generated at LOW
          // priority (~10-20s of dead air on a ~realtime GPU).
          // Fish pipelines its own marks at high priority (its LOOKAHEAD), so
          // preloading the SAME ssml at 'low' only made #synthesize's
          // high-never-waits-on-low rule generate the paragraph's first
          // sentence TWICE on the single GPU. Edge has no lookahead and this is
          // its only warm-up, so keep it for the other clients.
          if (this.ttsClient !== this.ttsFishClient) void this.preloadSSML(ssml, signal);
        }
        // Native AND Fish clients surface failures as a terminal 'error' code
        // (Edge/Web throw, which the catch below handles). Without Fish here, a
        // Claire-server hiccup (5xx/tunnel reset) mid-paragraph left the
        // transport wedged on "playing" with no advance — perceived as skipped
        // sentences. Skipping forward (bounded) recovers gracefully instead.
        const canSkipOnError =
          this.ttsClient === this.ttsNativeClient || this.ttsClient === this.ttsFishClient;
        const iter = await this.ttsClient.speak(ssml, signal);
        let lastCode;
        for await (const { code } of iter) {
          if (signal.aborted) {
            resolve();
            return;
          }
          lastCode = code;
        }

        // `!signal.aborted` mirrors the error branch below: without it an abort
        // landing between the last yield and here lets a stopped session advance
        // a second time — skipping a paragraph and killing the fresh session.
        if (lastCode === 'end' && !signal.aborted && this.state === 'playing' && !oneTime) {
          this.#consecutiveSpeakErrors = 0;
          resolve();
          await this.forward();
        } else if (
          lastCode === 'error' &&
          canSkipOnError &&
          !signal.aborted &&
          this.state === 'playing' &&
          !oneTime
        ) {
          // The native engine reported it can't speak this chunk. Offline this
          // is almost always a specific unsynthesizable utterance (e.g. an
          // unsupported character) that would fail every time, not a transient
          // glitch — so retrying the same text is futile. Skip it and advance
          // exactly as a normal 'end' would, so one bad chunk (often the first
          // utterance across a chapter boundary) can't strand playback with the
          // controls wedged in 'playing'. Bound consecutive failures so a
          // wholly-unusable engine stops gracefully instead of silently racing
          // to the end of the book. See #4613, #4408.
          this.#consecutiveSpeakErrors++;
          resolve();
          if (this.#consecutiveSpeakErrors <= TTS_NATIVE_SPEAK_MAX_CONSECUTIVE_ERRORS) {
            await this.forward();
          } else {
            this.#consecutiveSpeakErrors = 0;
            await this.stop();
          }
        }
        resolve();
      } catch (e) {
        if (signal.aborted) {
          resolve();
        } else {
          reject(e);
        }
      } finally {
        // Abort only OUR controller (cancels this session's preloads/listeners),
        // and clear the shared field only if it still points at us — never touch
        // a newer session's controller.
        controller.abort();
        if (this.#currentSpeakAbortController === controller) {
          this.#currentSpeakAbortController = null;
        }
      }
    });

    await this.#currentSpeakPromise.catch((e) => this.error(e));
  }

  async speak(ssml: string | Promise<string>, oneTime = false, oneTimeCallback?: () => void) {
    await this.initViewTTS();
    this.#speak(ssml, oneTime)
      .then(() => {
        if (oneTime && oneTimeCallback) {
          oneTimeCallback();
        }
      })
      .catch((e) => this.error(e));
    if (!oneTime) {
      this.preloadNextSSML();
      this.dispatchSpeakMark();
    }
  }

  play() {
    if (this.state !== 'playing') {
      this.start();
    } else {
      this.pause();
    }
  }

  async start() {
    await this.initViewTTS();
    // Always resume from the current list position instead of calling tts.start().
    // tts.start() resets the TTS list to position 0 (section beginning), which is
    // wrong when state transiently becomes 'stopped' during forward()/backward()
    // — a fast play tap in that window would otherwise jump back to section start.
    // tts.resume() falls back to tts.next() on a fresh TTS, so it's safe at init.
    const ssml = this.view.tts?.resume();
    if (this.state.includes('paused')) {
      this.resume();
    }
    this.#speak(ssml);
    this.preloadNextSSML();
  }

  async pause() {
    this.state = 'paused';
    // Surface the current "minutes d'avance" immediately so the control panel
    // shows the banked runway the moment the user pauses (banking then keeps it
    // growing via its own ticks).
    (this.ttsFishClient as FishAudioTTSClient).emitBankedAhead?.();
    if (!(await this.ttsClient.pause().catch((e) => this.error(e)))) {
      await this.stop();
      this.state = 'stop-paused';
    }
  }

  async resume() {
    this.state = 'playing';
    await this.ttsClient.resume().catch((e) => this.error(e));
  }

  async stop() {
    if (this.#currentSpeakAbortController) {
      this.#currentSpeakAbortController.abort();
    }
    await this.ttsClient.stop().catch((e) => this.error(e));

    if (this.#currentSpeakPromise) {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stop operation timed out')), 3000),
      );
      await Promise.race([this.#currentSpeakPromise.catch((e) => this.error(e)), timeout]).catch(
        (e) => this.error(e),
      );
      this.#currentSpeakPromise = null;
    }
    this.state = 'stopped';
  }

  // goto previous mark/paragraph
  async backward(byMark = false) {
    await this.initViewTTS();
    const isPlaying = this.state === 'playing';
    await this.stop();
    if (!isPlaying) this.state = 'backward-paused';

    const ssml = byMark ? this.view.tts?.prevMark(!isPlaying) : this.view.tts?.prev(!isPlaying);
    if (!ssml) {
      // toEnd=true: land on the previous chapter's LAST sentence, not its first.
      await this.#handleNavigationWithoutSSML(() => this.#initTTSForPrevSection(), isPlaying, true);
    } else {
      await this.#handleNavigationWithSSML(ssml, isPlaying);
    }
    if (isPlaying && !byMark) this.preloadNextSSML();
  }

  // goto next mark/paragraph
  async forward(byMark = false) {
    await this.initViewTTS();
    const isPlaying = this.state === 'playing';
    await this.stop();
    if (!isPlaying) this.state = 'forward-paused';

    const ssml = byMark ? this.view.tts?.nextMark(!isPlaying) : this.view.tts?.next(!isPlaying);
    if (!ssml) {
      await this.#handleNavigationWithoutSSML(() => this.#initTTSForNextSection(), isPlaying);
    } else {
      await this.#handleNavigationWithSSML(ssml, isPlaying);
    }
    if (isPlaying && !byMark) this.preloadNextSSML();
  }

  async setLang(lang: string) {
    this.ttsLang = lang;
    this.setPrimaryLang(lang);
  }

  async setPrimaryLang(lang: string) {
    if (this.ttsFishClient.initialized) this.ttsFishClient.setPrimaryLang(lang);
    if (this.ttsEdgeClient.initialized) this.ttsEdgeClient.setPrimaryLang(lang);
    if (this.ttsWebClient.initialized) this.ttsWebClient.setPrimaryLang(lang);
    if (this.ttsNativeClient?.initialized) this.ttsNativeClient?.setPrimaryLang(lang);
  }

  async setRate(rate: number) {
    this.state = 'setrate-paused';
    this.ttsRate = rate;
    await this.ttsClient.setRate(this.ttsRate);
  }

  async getVoices(lang: string) {
    const ttsFishVoices = await this.ttsFishClient.getVoices(lang);
    const ttsWebVoices = await this.ttsWebClient.getVoices(lang);
    const ttsEdgeVoices = await this.ttsEdgeClient.getVoices(lang);
    const ttsNativeVoices = (await this.ttsNativeClient?.getVoices(lang)) ?? [];

    // Fish Audio (Claire) leads the list so it surfaces at the top of the menu.
    const voicesGroups = [...ttsFishVoices, ...ttsNativeVoices, ...ttsEdgeVoices, ...ttsWebVoices];
    return voicesGroups;
  }

  async setVoice(voiceId: string, lang: string) {
    this.state = 'setvoice-paused';
    const useFishTTS = !!this.ttsFishVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    const useEdgeTTS = !!this.ttsEdgeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    const useNativeTTS = !!this.ttsNativeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    if (useFishTTS) {
      this.ttsClient = this.ttsFishClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else if (useEdgeTTS) {
      this.ttsClient = this.ttsEdgeClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else if (useNativeTTS) {
      if (!this.ttsNativeClient) {
        throw new Error('Native TTS client is not available');
      }
      this.ttsClient = this.ttsNativeClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else {
      this.ttsClient = this.ttsWebClient;
      await this.ttsClient.setRate(this.ttsRate);
    }
    TTSUtils.setPreferredClient(this.ttsClient.name);
    TTSUtils.setPreferredVoice(this.ttsClient.name, lang, voiceId);
    await this.ttsClient.setVoice(voiceId);
  }

  getVoiceId() {
    return this.ttsClient.getVoiceId();
  }

  getSpeakingLang() {
    return this.ttsClient.getSpeakingLang();
  }

  setTargetLang(lang: string) {
    this.ttsTargetLang = lang;
  }

  getSpokenSentence(): { cfi: string; text: string } | null {
    const range = this.view.tts?.getLastRange();
    if (!range || this.#ttsSectionIndex < 0) return null;
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      const text = range.toString().trim();
      if (!cfi || !text) return null;
      return { cfi, text };
    } catch {
      return null;
    }
  }

  // Canonical position signal emitted from the same paths as
  // tts-highlight-mark / tts-highlight-word. The controller is the source of
  // truth (it owns the section index and current word/sentence CFI).
  #dispatchPosition(cfi: string, kind: 'word' | 'sentence') {
    this.dispatchEvent(
      new CustomEvent('tts-position', {
        detail: {
          cfi,
          kind,
          sectionIndex: this.#ttsSectionIndex,
          sequence: ++ttsPositionSequence,
        },
      }),
    );
  }

  dispatchSpeakMark(mark?: TTSMark) {
    this.#resetSpeakWords();
    this.dispatchEvent(new CustomEvent('tts-speak-mark', { detail: mark || { text: '' } }));
    if (mark && mark.name !== '-1') {
      try {
        // When the active client highlights word-by-word, suppress the
        // sentence highlight that setMark would otherwise draw, so the page
        // doesn't flash the whole sentence before the first word. The fallback
        // (no boundaries) is drawn later in prepareSpeakWords. When the user
        // forces sentence granularity we keep the sentence highlight, so don't
        // suppress it.
        this.#suppressMarkHighlight =
          this.ttsClient.supportsWordBoundaries() && this.#highlightGranularity === 'word';
        const range = this.view.tts?.setMark(mark.name);
        this.#suppressMarkHighlight = false;
        this.#speakWordsArmed = !!range;
        const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
        this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi } }));
        this.#dispatchPosition(cfi, 'sentence');
      } catch {
        this.#suppressMarkHighlight = false;
      }
    }
  }

  #resetSpeakWords() {
    this.#speakWordsArmed = false;
    this.#speakWordBaseRange = null;
    this.#speakWordOffsets = [];
    this.#speakWordRanges = [];
    this.#wordHighlightActive = false;
    this.#lastSpeakWordRange = null;
  }

  // Re-apply the active highlight after the view relocates (page turn,
  // re-render). In word mode this re-draws the current word so the sentence
  // never reappears over it; otherwise it re-draws the sentence.
  reapplyCurrentHighlight() {
    if (this.#wordHighlightActive && this.#lastSpeakWordRange) {
      this.#getHighlighter()(this.#lastSpeakWordRange.cloneRange());
      return;
    }
    const range = this.view.tts?.getLastRange();
    if (range) this.#getHighlighter()(range.cloneRange());
  }

  // CFI of the currently highlighted word during word-by-word playback. Used
  // for the "in view" check that drives the back-to-TTS button: when a sentence
  // spans a page break, the word can be on a different page than the sentence's
  // ttsLocation, so the word position is the accurate reference. Returns null
  // outside word mode, where the sentence-level ttsLocation is correct.
  getCurrentHighlightCfi(): string | null {
    if (!this.#wordHighlightActive || !this.#lastSpeakWordRange || this.#ttsSectionIndex < 0) {
      return null;
    }
    try {
      return this.view.getCFI(this.#ttsSectionIndex, this.#lastSpeakWordRange) || null;
    } catch {
      return null;
    }
  }

  // Re-emit the controller's current position on the canonical 'tts-position'
  // signal with a fresh (monotonic) sequence. Lets a follower that engages
  // mid-session (paragraph / RSVP mode entered while TTS is already playing or
  // paused) sync to the current position without waiting for the next word or
  // sentence boundary. Mirrors reapplyCurrentHighlight's word-vs-sentence
  // choice, but dispatches a position instead of drawing a highlight.
  redispatchPosition() {
    if (this.#ttsSectionIndex < 0) return;
    if (this.#wordHighlightActive && this.#lastSpeakWordRange) {
      try {
        const cfi = this.view.getCFI(this.#ttsSectionIndex, this.#lastSpeakWordRange);
        if (cfi) {
          this.#dispatchPosition(cfi, 'word');
          return;
        }
      } catch {}
    }
    const range = this.view.tts?.getLastRange();
    if (!range) return;
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      if (cfi) this.#dispatchPosition(cfi, 'sentence');
    } catch {}
  }

  // Word-level highlighting within the chunk of the last dispatched mark,
  // driven by TTS clients that report word boundaries (Edge TTS). It only
  // swaps the visual highlight from the sentence to the spoken word —
  // ttsLocation, media-session metadata and mark navigation keep their
  // sentence-level semantics.
  // Returns whether word-level tracking is actually armed, so a client can skip
  // starting its per-frame tracking loop when the highlight stays sentence-level
  // (otherwise a 60fps rAF loop runs for every sentence and does nothing).
  prepareSpeakWords(words: string[]): boolean {
    if (!this.#speakWordsArmed) return false;
    // User forced sentence-level highlighting: the sentence highlight was drawn
    // at mark dispatch (not suppressed), so there's nothing to do here — leave
    // word mode off even though the client reported word boundaries.
    if (this.#highlightGranularity === 'sentence') return false;
    const range = this.view.tts?.getLastRange();
    if (!range) return false;
    this.#speakWordBaseRange = range;
    const matchText = rangeTextExcludingInert(range);
    this.#speakWordOffsets = computeWordOffsets(matchText, words);
    this.#speakWordRanges = [];
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only trace of the Edge word-sync: each spoken (boundary) word vs the
      // text it actually highlights. A drifted or "(unmatched)" mapping — or an
      // empty word list — pinpoints word-highlight bugs without instrumenting
      // the overlayer by hand. `process.env.NODE_ENV` is statically inlined, so
      // this whole block is dropped from production builds.
      const mapping = words.map((word, i) => {
        const offset = this.#speakWordOffsets[i];
        const highlighted = offset
          ? getTextSubRange(range, offset.start, offset.end)?.toString()
          : '';
        return { spoken: word, highlighted: highlighted || '(unmatched)' };
      });
      console.log('[TTS] word-sync', { sentence: matchText, words: mapping });
    }
    if (words.length === 0) {
      // No word boundaries for this chunk: the sentence highlight was
      // suppressed at mark dispatch, so draw it now as the fallback.
      this.#wordHighlightActive = false;
      this.#getHighlighter()(range.cloneRange());
      return false;
    }
    // Highlight the first word immediately so the suppressed sentence
    // highlight never appears before playback reaches the first boundary.
    this.#wordHighlightActive = true;
    this.dispatchSpeakWord(0);
    return true;
  }

  dispatchSpeakWord(index: number) {
    const base = this.#speakWordBaseRange;
    if (!base) return;
    let range = this.#speakWordRanges[index];
    if (range === undefined) {
      const offset = this.#speakWordOffsets[index];
      range = offset ? getTextSubRange(base, offset.start, offset.end) : null;
      this.#speakWordRanges[index] = range;
    }
    if (range) {
      this.#lastSpeakWordRange = range;
      this.#getHighlighter()(range.cloneRange());
      // Let the view follow the spoken word so it turns the page mid-sentence
      // when the word crosses a page boundary, instead of waiting for the next
      // sentence's mark.
      try {
        const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
        if (cfi) {
          this.dispatchEvent(new CustomEvent('tts-highlight-word', { detail: { cfi } }));
          this.#dispatchPosition(cfi, 'word');
        }
      } catch {}
    }
  }

  error(e: unknown) {
    // AbortError is expected during normal stop/restart cycles (rate change,
    // forward/backward, voice change) — on iOS especially, the in-flight
    // audio.play() promise rejects with AbortError after audio.src is reset,
    // and that rejection can leak through one of the .catch chains. Letting it
    // flip state to 'stopped' desyncs the state machine: handleSetRate's
    // `state === 'playing'` check then falls through to a no-op, and #speak's
    // auto-forward gate skips advancing to the next paragraph.
    if (e instanceof Error && (e.name === 'AbortError' || e.message === 'Aborted')) {
      return;
    }
    console.error(e);
    this.state = 'stopped';
  }

  async shutdown() {
    this.#prefetchAbortController.abort();
    await this.stop();
    this.#clearHighlighter();
    this.#ttsSectionIndex = -1;
    this.view.tts = null;
    if (this.ttsWebClient.initialized) {
      await this.ttsWebClient.shutdown();
    }
    if (this.ttsEdgeClient.initialized) {
      await this.ttsEdgeClient.shutdown();
    }
    if (this.ttsFishClient.initialized) {
      await this.ttsFishClient.shutdown();
    }
    if (this.ttsNativeClient?.initialized) {
      await this.ttsNativeClient.shutdown();
    }
  }
}
