import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookProgress } from '@/store/readerProgressStore';
import { useProofreadStore } from '@/store/proofreadStore';
import { FoliateView } from '@/types/view';
import {
  PendingCorrection,
  canProofread,
  isProofreadOff,
  loadParagraphStates,
  requestProofread,
  saveParagraphStates,
  setProofreadOff,
} from '@/services/ai/proofread';
import {
  applyCorrectionsToDocs,
  collectPageParagraphs,
  hashParagraph,
  locateInNodes,
  paragraphText,
} from '@/utils/aiProofreadDom';

// Proofread a page once the reader has stayed on it this long: pages skimmed
// past (or turned by the voice in quick succession) are not paid for.
const DWELL_MS = 2500;

export interface ProofreadProposal extends PendingCorrection {
  /** Hash of the paragraph's text when proposed. */
  hash: string;
  el: HTMLElement;
}

/**
 * Automatic AI proofreading of the page being read. Proposes corrections for
 * the visible paragraphs; nothing changes until the reader keeps them, and then
 * they are saved as book rules — the book stays corrected on every later open,
 * for display, translation and voice alike.
 */
export function useAIProofread(bookKey: string, viewRef: RefObject<FoliateView | null>) {
  const { envConfig } = useEnv();
  const addRule = useProofreadStore((s) => s.addRule);
  const location = useBookProgress(bookKey)?.location;
  const bookHash = bookKey.split('-')[0]!;
  const [proposals, setProposals] = useState<ProofreadProposal[]>([]);
  const pageRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const page = ++pageRef.current;
    setProposals([]);
    if (!location || isProofreadOff(bookHash)) return;

    const check = async () => {
      // Screen off (listening): nobody can answer, so nothing is spent.
      if (document.visibilityState !== 'visible') return;
      const range = viewRef.current?.lastLocation?.range;
      if (!range) return;
      const paragraphs = collectPageParagraphs(range).map((p) => ({
        ...p,
        hash: hashParagraph(p.text),
      }));
      if (!paragraphs.length) return;

      const states = loadParagraphStates(bookHash);
      const found: ProofreadProposal[] = [];
      const fresh = paragraphs.filter((p) => {
        const state = states[p.hash];
        if (Array.isArray(state))
          found.push(...state.map((c) => ({ ...c, hash: p.hash, el: p.el })));
        return state === undefined;
      });

      if (fresh.length && !inFlightRef.current && canProofread()) {
        inFlightRef.current = true;
        try {
          const corrections = await requestProofread(fresh.map((p) => p.text));
          const byParagraph = new Map<number, PendingCorrection[]>();
          for (const c of corrections) {
            const para = fresh[c.p];
            // Only what can be placed in the book's own text is ever proposed.
            const find = para ? locateInNodes(para.nodes, c.find) : null;
            if (!find || find === c.replace) continue;
            byParagraph.set(c.p, [...(byParagraph.get(c.p) ?? []), { find, replace: c.replace }]);
          }
          // Re-read: another page may have saved its own results meanwhile.
          const latest = loadParagraphStates(bookHash);
          fresh.forEach((para, i) => {
            const list = byParagraph.get(i);
            latest[para.hash] = list ?? 'clean';
            if (list) found.push(...list.map((c) => ({ ...c, hash: para.hash, el: para.el })));
          });
          saveParagraphStates(bookHash, latest);
        } catch (err) {
          console.warn('AI proofreading failed:', err);
        } finally {
          inFlightRef.current = false;
        }
      }
      if (page === pageRef.current) setProposals(found);
    };

    const timer = setTimeout(() => void check(), DWELL_MS);
    return () => clearTimeout(timer);
  }, [location, bookHash, viewRef]);

  const settle = useCallback(
    (handled: ProofreadProposal[]) => {
      const states = loadParagraphStates(bookHash);
      for (const p of handled) {
        states[p.hash] = 'decided';
        // A kept correction changes the paragraph: its new text is settled too.
        states[hashParagraph(paragraphText(p.el))] = 'decided';
      }
      saveParagraphStates(bookHash, states);
    },
    [bookHash],
  );

  const keep = useCallback(async () => {
    const handled = proposals;
    setProposals([]);
    const unique = [...new Map(handled.map((p) => [`${p.find}\u0000${p.replace}`, p])).values()];
    const docs = (viewRef.current?.renderer.getContents() ?? [])
      .map((c) => c.doc)
      .filter((d): d is Document => !!d);
    // Visible at once; the rules make it last (every later render applies them).
    applyCorrectionsToDocs(docs, unique);
    settle(handled);
    for (const c of unique) {
      try {
        await addRule(envConfig, bookKey, {
          scope: 'book',
          pattern: c.find,
          replacement: c.replace,
          isRegex: false,
          caseSensitive: true,
          wholeWord: false,
        });
      } catch (err) {
        console.warn('Could not save AI correction:', err);
      }
    }
  }, [proposals, viewRef, settle, addRule, envConfig, bookKey]);

  const ignore = useCallback(() => {
    settle(proposals);
    setProposals([]);
  }, [proposals, settle]);

  const turnOff = useCallback(() => {
    setProofreadOff(bookHash);
    ignore();
  }, [bookHash, ignore]);

  return { proposals, keep, ignore, turnOff };
}
