import { useCallback, useEffect, useRef, useState } from 'react';
import { FoliateView } from '@/types/view';
import { UseTranslatorOptions } from '@/services/translators';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslator } from '@/hooks/useTranslator';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { blockSourceText, walkTextNodes } from '@/utils/walk';
import { debounce } from '@/utils/debounce';
import { getLocale } from '@/utils/misc';
import { createTranslationWrapper, SAME_IN_TRANSLATION } from '@/utils/translationDom';
import { voiceLog } from '@/utils/voiceLog';
import { applyRulesToText, getCorrectionRules } from '@/services/transformers/proofread';

export function useTextTranslation(
  bookKey: string,
  view: FoliateView | HTMLElement | null,
  widthLineBreak = false,
  targetBlockClassName = 'translation-target-block',
) {
  const _ = useTranslation();
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setIsLoading = useReaderStore((s) => s.setIsLoading);
  const viewSettings = getViewSettings(bookKey);
  // Reactive: triggers translate-in-range on every page turn so the
  // visible viewport's translations refresh. Reads from
  // readerProgressStore only.
  const progress = useBookProgress(bookKey);

  const enabled = useRef(viewSettings?.translationEnabled);
  const [provider, setProvider] = useState(viewSettings?.translationProvider);
  const [targetLang, setTargetLang] = useState(viewSettings?.translateTargetLang);
  const showTranslateSourceRef = useRef(viewSettings?.showTranslateSource);

  const { translate } = useTranslator({
    provider,
    targetLang: targetLang || getLocale(),
  } as UseTranslatorOptions);

  const translateRef = useRef(translate);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const translatedElements = useRef<HTMLElement[]>([]);
  const allTextNodes = useRef<HTMLElement[]>([]);
  const translationQueue = useRef<HTMLElement[]>([]);
  const activeTranslations = useRef(0);
  const MAX_CONCURRENT_TRANSLATIONS = 5;
  // Longer than any translator's own limit (the AI gives up after 30 s and
  // hands the paragraph to Google, which gives up after 15 s).
  const TRANSLATION_SLOT_MS = 60_000;
  const pendingDOMUpdates = useRef<Array<() => void>>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleTranslationVisibility = (visible: boolean) => {
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => {
        if (visible) {
          target.classList.remove('hidden');
        } else {
          target.classList.add('hidden');
        }
      });
    });
  };

  useEffect(() => {
    translateRef.current = translate;
  }, [translate]);

  const hintInitialTranslating = () => {
    setIsLoading(bookKey, true);
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Translating...'),
    });
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      setIsLoading(bookKey, false);
    }, 2000);
  };

  const observeTextNodes = () => {
    if (!view || !enabled.current) return;

    const observer = createTranslationObserver();
    observerRef.current = observer;
    const nodes = walkTextNodes(view, ['pre', 'code', 'math']);
    console.log(
      'Observing text nodes for translation:',
      nodes.length,
      // nodes.map((n) => n.textContent),
    );
    allTextNodes.current = nodes;
    nodes.forEach((el) => observer.observe(el));
  };

  const updateTranslation = () => {
    translationQueue.current = [];
    activeTranslations.current = 0;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    pendingDOMUpdates.current = [];
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => target.remove());
    });

    translatedElements.current = [];
    if (viewSettings?.translationEnabled && view) {
      recreateTranslationObserver();
    }
  };

  const createTranslationObserver = () => {
    const visibleElements = new Set<HTMLElement>();
    return new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleElements.add(entry.target as HTMLElement);
          } else {
            visibleElements.delete(entry.target as HTMLElement);
          }
        }

        if (visibleElements.size === 0) return;

        const nodes = allTextNodes.current;
        if (nodes.length === 0) return;

        let firstIdx = nodes.length;
        let lastIdx = -1;
        for (const el of visibleElements) {
          const idx = nodes.indexOf(el);
          if (idx !== -1) {
            if (idx < firstIdx) firstIdx = idx;
            if (idx > lastIdx) lastIdx = idx;
          }
        }

        if (lastIdx === -1) return;

        // Translate well past the visible range so that when TTS follows the
        // reading position, upcoming paragraphs are already in French by the time
        // the audio prefetch reaches them — no stall waiting on the translator.
        // This is what makes banked audio actually REUSABLE in translation mode:
        // the banker/lookahead read the LIVE DOM via view.tts.next(), so only a
        // paragraph whose French is already injected here yields the exact text
        // (and thus the exact audio cache key) playback will later synthesize.
        // Reach far enough to stay ahead of preloadNextSSML's lookahead (~10) plus
        // the visible span. Concurrency is capped by MAX_CONCURRENT_TRANSLATIONS
        // and already-translated paragraphs are skipped, so this only front-loads
        // work that would happen anyway.
        const startIdx = Math.max(0, firstIdx - 1);
        const endIdx = Math.min(nodes.length - 1, lastIdx + 16);

        for (let i = startIdx; i <= endIdx; i++) {
          const node = nodes[i];
          if (node) {
            scheduleTranslation(node);
          }
        }
      },
      { threshold: 0 },
    );
  };

  const scheduleTranslation = (el: HTMLElement) => {
    if (!enabled.current) return;
    if (el.classList.contains('translation-target')) return;
    if (el.querySelector('.translation-target')) return;
    if (translationQueue.current.indexOf(el) !== -1) return;
    translationQueue.current.push(el);
    drainTranslationQueue();
  };

  const drainTranslationQueue = () => {
    while (
      activeTranslations.current < MAX_CONCURRENT_TRANSLATIONS &&
      translationQueue.current.length > 0
    ) {
      const el = translationQueue.current.shift()!;
      if (el.querySelector('.translation-target') || !enabled.current) continue;
      activeTranslations.current++;
      // A translation that never settles must not keep its place for good:
      // with five of them, nothing else would ever be translated.
      let timer: ReturnType<typeof setTimeout> | undefined;
      Promise.race([
        translateElement(el),
        new Promise((resolve) => (timer = setTimeout(resolve, TRANSLATION_SLOT_MS))),
      ]).finally(() => {
        clearTimeout(timer);
        activeTranslations.current--;
        drainTranslationQueue();
      });
    }
    if (translationQueue.current.length === 0 && activeTranslations.current === 0) {
      setTimeout(() => {
        setIsLoading(bookKey, false);
      }, 500);
    }
  };

  const batchDOMUpdate = (update: () => void) => {
    pendingDOMUpdates.current.push(update);
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(() => {
        batchTimerRef.current = null;
        const updates = pendingDOMUpdates.current.splice(0);
        updates.forEach((fn) => fn());
      }, 50);
    }
  };

  const recreateTranslationObserver = () => {
    const observer = createTranslationObserver();
    observerRef.current?.disconnect();
    observerRef.current = observer;
    allTextNodes.current.forEach((el) => observer.observe(el));
  };

  // `now`: put the translation in the page at once instead of with the next
  // batch of page updates — the voice is waiting for it (see 'translate-blocks').
  const translateElement = async (el: HTMLElement, now = false) => {
    if (!enabled.current || el.querySelector('.translation-target')) return;
    // blockSourceText, not textContent: the latter glues child fragments with no
    // separator (a two-part heading became "Chapter 15You Are a Perfect...").
    // TTSController's prefetch uses the same helper — they must agree or the
    // pre-generated audio is keyed on a different string and never reused.
    const text = blockSourceText(el);
    if (!text) return;

    if (el.classList.contains('translation-target')) {
      return;
    }

    const updateSourceNodes = (element: HTMLElement) => {
      const hasDirectText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '',
      );
      if (hasDirectText) {
        element.classList.add('translation-source');

        const textNodes = Array.from(element.childNodes).filter(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '',
        );

        if (!element.hasAttribute('original-text-stored')) {
          element.setAttribute(
            'original-text-nodes',
            JSON.stringify(textNodes.map((node) => node.textContent)),
          );
          element.setAttribute('original-text-stored', 'true');
        }
      }
      const isSource = element.classList.contains('translation-source');
      if (isSource) {
        const textNodes = Array.from(element.childNodes).filter(
          (node) => node.nodeType === Node.TEXT_NODE,
        ) as Text[];

        if (showTranslateSourceRef.current) {
          const originalTexts = JSON.parse(element.getAttribute('original-text-nodes') || '[]');
          textNodes.forEach((textNode, index) => {
            if (originalTexts[index] !== undefined) {
              textNode.textContent = originalTexts[index];
            }
          });
        } else {
          textNodes.forEach((textNode) => {
            textNode.textContent = '';
          });
        }
      }
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const node = child as HTMLElement;
        if (!node.classList.contains('translation-target')) {
          updateSourceNodes(node);
        }
      }
    };

    try {
      const translated = await translateRef.current([text]);
      // The reader's own corrections of translated text (see applyRulesToText);
      // the TTS prefetch applies the same, so spoken and shown text stay equal.
      const translatedText = applyRulesToText(
        translated[0] ?? '',
        getCorrectionRules(getViewSettings(bookKey)?.proofreadRules),
      );
      if (!translatedText) return;
      if (text === translatedText) {
        // Nothing to translate (a name, a number…): the voice reads it as it
        // is instead of stopping for want of a translation.
        el.setAttribute(SAME_IN_TRANSLATION, '');
        return;
      }

      const wrapper = createTranslationWrapper(document, translatedText, {
        lang: targetLang || getLocale(),
        hidden: !enabled.current,
        lineBreak: widthLineBreak,
        blockClassName: targetBlockClassName,
      });

      if (el.querySelector('.translation-target')) {
        return;
      }
      const inject = () => {
        if (!enabled.current || el.querySelector('.translation-target')) return;
        updateSourceNodes(el);
        el.appendChild(wrapper);
        translatedElements.current.push(el);
      };
      if (now) inject();
      else batchDOMUpdate(inject);
    } catch (err) {
      console.warn('Translation failed:', err);
    }
  };

  const findNodeIndicesInRange = (range: Range, nodes: HTMLElement[]) => {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    let startIndex = -1;
    let endIndex = -1;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node === startContainer || node.contains(startContainer)) {
        if (startIndex === -1) startIndex = i;
      }
      if (node === endContainer || node.contains(endContainer)) {
        endIndex = i;
      }
    }
    if (startIndex !== -1 && endIndex === -1) {
      endIndex = startIndex;
    }

    return { startIndex, endIndex };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const translateInRange = useCallback(
    debounce((range: Range) => {
      const nodes = allTextNodes.current;
      if (nodes.length === 0) {
        console.warn('No text nodes available for translation.');
        return;
      }
      const { startIndex, endIndex } = findNodeIndicesInRange(range, nodes);
      if (startIndex === -1) {
        console.log('Range not found in text nodes');
        return;
      }
      const beforeContext = 2;
      const afterContext = 5;
      const beforeStart = Math.max(0, startIndex - beforeContext);
      const afterEnd = Math.min(nodes.length - 1, endIndex + afterContext);
      for (let i = beforeStart; i <= afterEnd; i++) {
        const node = nodes[i];
        if (node) {
          scheduleTranslation(node);
        }
      }
    }, 500),
    [scheduleTranslation],
  );

  // The voice, reading both languages, asks for the paragraphs it is about to
  // read (TTSController#bringTranslation): what is translated above follows
  // the screen, and with the screen off nothing is drawn — no page turns, no
  // visible paragraphs — so from the last page shown on, the voice went on in
  // English only (17 Oct 2026). `now`: the voice waits for these; the others
  // are the ones it reads next. Neither goes through the queue above: the
  // voice's few paragraphs must not wait behind the screen's, and the same
  // paragraph asked for again shares the request already made.
  const translateElementRef = useRef(translateElement);
  useEffect(() => {
    translateElementRef.current = translateElement;
  });
  const voiceRequests = useRef(new Map<HTMLElement, Promise<void>>());
  useEffect(() => {
    if (!view || !('renderer' in view)) return;
    const translateForVoice = (el: HTMLElement) => {
      let request = voiceRequests.current.get(el);
      if (!request) {
        const asked = Date.now();
        request = translateElementRef.current(el, true).finally(() => {
          voiceRequests.current.delete(el);
          const done = el.querySelector('.translation-target') ? 'translated' : 'NOT translated';
          voiceLog(
            `[voice] ${done} in ${Date.now() - asked} ms: "${blockSourceText(el).slice(0, 40)}"`,
          );
        });
        voiceRequests.current.set(el, request);
      }
      return request;
    };
    const onTranslateBlocks = async (event: CustomEvent) => {
      const detail = event.detail as { bookKey: string; elements: HTMLElement[]; now?: boolean };
      if (detail.bookKey !== bookKey || !enabled.current) return;
      const requests = detail.elements.map(translateForVoice);
      if (detail.now) await Promise.all(requests);
    };
    eventDispatcher.on('translate-blocks', onTranslateBlocks);
    return () => eventDispatcher.off('translate-blocks', onTranslateBlocks);
  }, [bookKey, view]);

  useEffect(() => {
    if (enabled.current && progress) {
      const { range } = progress;
      translateInRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (!viewSettings) return;

    const enabledChanged = enabled.current !== viewSettings.translationEnabled;
    const providerChanged = provider !== viewSettings.translationProvider;
    const targetLangChanged = targetLang !== viewSettings.translateTargetLang;
    const showTranslateSourceChanged =
      showTranslateSourceRef.current !== viewSettings.showTranslateSource;

    if (enabledChanged) {
      enabled.current = viewSettings.translationEnabled;
    }

    if (providerChanged) {
      setProvider(viewSettings.translationProvider);
    }

    if (targetLangChanged) {
      setTargetLang(viewSettings.translateTargetLang);
    }

    if (showTranslateSourceChanged) {
      showTranslateSourceRef.current = viewSettings.showTranslateSource;
    }

    if (enabledChanged) {
      toggleTranslationVisibility(viewSettings.translationEnabled);
      if (enabled.current) {
        observeTextNodes();
      }
    } else if (providerChanged || targetLangChanged || showTranslateSourceChanged) {
      updateTranslation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, viewSettings, provider, targetLang]);

  useEffect(() => {
    if (!view || !enabled.current) return;

    if ('renderer' in view) {
      view.addEventListener('load', observeTextNodes);
      view.addEventListener('load', hintInitialTranslating);
    } else {
      observeTextNodes();
    }
    return () => {
      if ('renderer' in view) {
        view.removeEventListener('load', observeTextNodes);
        view.removeEventListener('load', hintInitialTranslating);
      }
      observerRef.current?.disconnect();
      translatedElements.current = [];
      translationQueue.current = [];
      activeTranslations.current = 0;
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      pendingDOMUpdates.current = [];
      setIsLoading(bookKey, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
