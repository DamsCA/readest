import { isSameLang } from '@/utils/lang';
import { blockSourceText, walkTextNodes } from '@/utils/walk';

// Reading both languages, the voice reads what the page holds: a paragraph is
// read in the translation only once the reader's translator has put it in the
// page. These find what the voice is about to read that is not translated yet.

const LETTER = /\p{L}/u;

/** Whether the SSML has a part in `lang` (the translation the reader puts in the page). */
export const hasLangPart = (ssml: string, lang: string) => {
  for (const match of ssml.matchAll(/<lang\s+xml:lang="([^"]+)"/g)) {
    if (isSameLang(match[1], lang)) return true;
  }
  return false;
};

const untranslated = (el: HTMLElement) =>
  !el.classList.contains('translation-target') &&
  !el.querySelector('.translation-target') &&
  LETTER.test(blockSourceText(el));

/**
 * The page's elements the reader's translator works on (the same walk as
 * useTextTranslation): those of the paragraph read now (`block`, its spoken
 * sentences) still untranslated, and those untranslated among the `ahead`
 * ones after it.
 */
export const untranslatedParagraphs = (doc: Document, block: Range, ahead: number) => {
  const current: HTMLElement[] = [];
  const next: HTMLElement[] = [];
  if (!doc.body) return { current, next };
  let after = 0;
  for (const el of walkTextNodes(doc.body as HTMLElement, ['pre', 'code', 'math'])) {
    if (block.intersectsNode(el)) {
      if (untranslated(el)) current.push(el);
      continue;
    }
    if (block.comparePoint(el, 0) < 0) continue;
    if (after++ >= ahead) break;
    if (untranslated(el)) next.push(el);
  }
  return { current, next };
};
