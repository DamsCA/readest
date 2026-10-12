import type { ProofreadRule } from '@/types/book';
import type { PendingCorrection } from '@/services/ai/proofread';
import { applyRulesToTextNodes, ruleMatches } from '@/services/transformers/proofread';
import { walkTextNodes } from '@/utils/walk';

// The page as the AI proofreader sees it, and the way back from its answers to
// the book's own text. Everything works on the book's text nodes: a correction
// is saved as a plain book rule, which the proofread transformer applies text
// node by text node, so a correction that only exists across two nodes (an
// error straddling italics) could never be applied and is dropped here.

export interface PageParagraph {
  el: HTMLElement;
  /** Whitespace-collapsed text, as sent to the AI. */
  text: string;
  /** The book's own text nodes (injected translations excluded). */
  nodes: Text[];
}

const isInjected = (node: Node): boolean => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!el?.closest('.translation-target, rt, rp, script, style');
};

export const sourceTextNodes = (root: Node): Text[] => {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!isInjected(n)) nodes.push(n as Text);
  }
  return nodes;
};

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export const paragraphText = (el: HTMLElement) =>
  collapse(
    sourceTextNodes(el)
      .map((n) => n.data)
      .join(''),
  );

// Under 3 words there is little to fix and much to misread (titles, numbers).
const MIN_WORDS = 3;

/** The paragraphs of the visible page whose own text is shown (a hidden source is skipped). */
export const collectPageParagraphs = (visible: Range): PageParagraph[] => {
  const container = visible.commonAncestorContainer;
  const doc = container.ownerDocument ?? (container as Document);
  if (!doc.body) return [];
  const paragraphs: PageParagraph[] = [];
  for (const el of walkTextNodes(doc.body, ['pre', 'code', 'math'])) {
    if (el.closest('.translation-target') || !visible.intersectsNode(el)) continue;
    const nodes = sourceTextNodes(el);
    const text = collapse(nodes.map((n) => n.data).join(''));
    if (text.split(' ').length < MIN_WORDS) continue;
    paragraphs.push({ el, text, nodes });
  }
  return paragraphs;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The book's exact text for an excerpt the AI quoted, inside a single text
 * node, and only where a rule with that pattern would apply (same word
 * boundaries as the transformer). The AI saw collapsed whitespace; the book may
 * hold a line break there, which the saved pattern must keep. Null when the
 * excerpt spans formatting, sits inside a longer word, or is too vague to
 * place (punctuation only).
 */
export const locateInNodes = (nodes: Text[], find: string): string | null => {
  const words = find.trim().split(/\s+/).filter(Boolean);
  if (!words.length || !/[\p{L}\p{N}]/u.test(find)) return null;
  const flexible = new RegExp(words.map(escapeRegExp).join('\\s+'), 'gu');
  for (const node of nodes) {
    flexible.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = flexible.exec(node.data)) !== null) {
      if (ruleMatches(node.data, match[0])) return match[0];
      flexible.lastIndex = match.index + 1;
    }
  }
  return null;
};

/** Shows kept corrections at once in the loaded sections, as book rules would on the next render. */
export const applyCorrectionsToDocs = (docs: Document[], corrections: PendingCorrection[]) => {
  const rules = corrections.map(
    (c, order) =>
      ({
        id: `ai-${order}`,
        scope: 'book',
        pattern: c.find,
        replacement: c.replace,
        enabled: true,
        isRegex: false,
        caseSensitive: true,
        order,
      }) as ProofreadRule,
  );
  for (const doc of docs) {
    if (!doc.body) continue;
    applyRulesToTextNodes(
      sourceTextNodes(doc.body).filter((n) => n.data.trim()),
      rules,
    );
  }
};

/** Stable key for a paragraph's text (djb2 + length). */
export const hashParagraph = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${text.length.toString(16)}`;
};
