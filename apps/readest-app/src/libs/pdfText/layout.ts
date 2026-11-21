/**
 * Rebuilds flowing text from the positioned text runs of PDF pages.
 *
 * A PDF page is a drawing: each run of text is painted at an x/y position and
 * nothing says where a paragraph starts or ends. These functions recover the
 * reading structure the way a careful typesetter would: lines from baselines,
 * paragraphs from spacing, indents and line endings, headings from font size,
 * and they drop running headers, footers and page numbers.
 *
 * Everything here is pure (no pdf.js, no DOM) so it can be unit-tested.
 */

export interface PdfTextRun {
  str: string;
  /** Left edge, in page units, origin at the top-left corner. */
  x: number;
  /** Baseline, in page units, measured from the TOP of the page. */
  y: number;
  width: number;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  hasEOL?: boolean;
  dir?: string;
}

export interface PdfLine {
  text: string;
  x: number;
  xEnd: number;
  y: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

export interface PdfPageText {
  index: number;
  width: number;
  height: number;
  lines: PdfLine[];
}

/** A piece of text and the PDF page it came from (0-based). */
export interface PdfSegment {
  text: string;
  page: number;
}

export type PdfBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; segments: PdfSegment[] }
  | {
      kind: 'paragraph';
      segments: PdfSegment[];
      /** Laid out centred on the page (titles, epigraphs, separators). */
      center?: boolean;
      /** Starts with a bullet or a number. */
      list?: boolean;
      /** The first line was indented, which marks a new paragraph. */
      indented?: boolean;
    }
  | { kind: 'image'; page: number; src: string };

export interface LayoutStats {
  /** Font size of the body text, the most common size weighted by characters. */
  bodySize: number;
  /** Usual left and right edges of the text block, from pages full of text. */
  left?: number;
  right?: number;
  /** Usual left edge of even and odd pages (index 0 and 1), for mirrored margins. */
  leftByParity?: [number, number];
}

/** Share of the page height, at the top and at the bottom, where running heads live. */
export const MARGIN_ZONE = 0.1;

// A sentence ends with its punctuation, possibly followed by a closing quote
// (straight or curly) or bracket: "...yourself!'" ends a line of dialogue.
const TERMINAL_PUNCTUATION = /[.!?…:»"”’')\]]\s*$/;
const STARTS_LOWERCASE = /^[\p{Ll}]/u;
const LIST_MARKER = /^(?:[•◦▪▫●○■□➢►✓✔*]|[-–—](?=\s)|\(?\d{1,3}[.)](?=\s)|\(?[a-z][.)](?=\s))/u;
const HYPHEN_AT_END = /[\p{L}][-‐­]$/u;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
};

const normalizeSpaces = (text: string) => text.replace(/[\s ]+/g, ' ').trim();

/**
 * Groups the runs of one page into lines. Runs arrive in content-stream order,
 * which follows the reading order in the vast majority of books; a run that
 * moves to another baseline, or jumps back to the left, starts a new line.
 */
export function runsToLines(runs: PdfTextRun[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let current: PdfTextRun[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const rtl = current.filter((r) => r.dir === 'rtl').length > current.length / 2;
    const ordered = [...current].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    const gapAfter = (a: PdfTextRun, b: PdfTextRun) =>
      rtl ? a.x - (b.x + b.width) : b.x - (a.x + a.width);
    // Letter-spaced text ("C H A P T E R") comes one glyph per run: only a gap
    // clearly wider than the usual one between letters is a word space.
    const visible = ordered.filter((r) => r.str.trim());
    const singles = visible.filter((r) => r.str.trim().length === 1).length;
    let letterGap = -Infinity;
    if (visible.length >= 4 && singles / visible.length >= 0.6) {
      const gaps: number[] = [];
      for (let i = 1; i < visible.length; i++) gaps.push(gapAfter(visible[i - 1]!, visible[i]!));
      letterGap = median(gaps);
    }
    let text = '';
    let prev: PdfTextRun | null = null;
    for (const run of ordered) {
      if (prev && text && !/\s$/.test(text) && !/^\s/.test(run.str)) {
        const gap = gapAfter(prev, run);
        const size = Math.min(prev.fontSize, run.fontSize);
        const threshold =
          letterGap > -Infinity ? Math.max(letterGap + size * 0.25, size * 0.15) : size * 0.15;
        if (gap > threshold) text += ' ';
      }
      text += run.str;
      prev = run;
    }
    text = normalizeSpaces(text);
    if (text) {
      // Weight style and size by characters so a lone large drop cap or a tiny
      // footnote mark does not decide the size of the whole line.
      const weights = new Map<number, number>();
      let boldChars = 0;
      let italicChars = 0;
      let totalChars = 0;
      for (const run of ordered) {
        const n = run.str.trim().length;
        if (!n) continue;
        const size = Math.round(run.fontSize * 10) / 10;
        weights.set(size, (weights.get(size) ?? 0) + n);
        if (run.bold) boldChars += n;
        if (run.italic) italicChars += n;
        totalChars += n;
      }
      let fontSize = ordered[0]!.fontSize;
      let best = -1;
      for (const [size, w] of weights) {
        if (w > best) {
          best = w;
          fontSize = size;
        }
      }
      const xs = ordered.map((r) => r.x);
      const xEnds = ordered.map((r) => r.x + r.width);
      const baselineRun = ordered.reduce((a, b) =>
        b.str.trim().length > a.str.trim().length ? b : a,
      );
      lines.push({
        text,
        x: Math.min(...xs),
        xEnd: Math.max(...xEnds),
        y: baselineRun.y,
        fontSize,
        bold: totalChars > 0 && boldChars / totalChars > 0.6,
        italic: totalChars > 0 && italicChars / totalChars > 0.6,
      });
    }
    current = [];
  };

  for (const run of runs) {
    if (!run.str) {
      if (run.hasEOL) flush();
      continue;
    }
    const last = current[current.length - 1];
    if (last) {
      const tolerance = Math.max(run.fontSize, last.fontSize) * 0.45;
      const sameBaseline = Math.abs(run.y - last.y) <= tolerance;
      const jumpedBack = run.x < last.x - Math.max(run.fontSize, last.fontSize) * 2;
      if (!sameBaseline || (jumpedBack && run.dir !== 'rtl')) flush();
    }
    if (run.str.trim() || current.length > 0) current.push(run);
    if (run.hasEOL) flush();
  }
  flush();
  return lines;
}

/** Key used to recognise a running head on many pages: digits do not count. */
export function marginKey(text: string): string {
  return normalizeSpaces(text.toLowerCase().replace(/\d+/g, '#'));
}

/** Page numbers in their usual dresses: "12", "- 12 -", "Page 12", "12 / 240", "xiv". */
export function isPageNumber(text: string): boolean {
  const t = normalizeSpaces(text).toLowerCase();
  if (!t || t.length > 24) return false;
  if (/^[-–—[(\s]*\d{1,4}[-–—\])\s]*$/.test(t)) return true;
  if (/^(page|p\.|pg\.?)\s*\d{1,4}(\s*(\/|of|sur|de)\s*\d{1,5})?$/.test(t)) return true;
  if (/^\d{1,4}\s*(\/|of|sur|de)\s*\d{1,5}$/.test(t)) return true;
  if (/^[ivxlcdm]{1,7}$/.test(t)) return true;
  return false;
}

export const isInMarginZone = (line: PdfLine, page: { height: number }) =>
  line.y < page.height * MARGIN_ZONE || line.y > page.height * (1 - MARGIN_ZONE);

/**
 * Finds the running heads and feet of a document: lines sitting in the top or
 * bottom margin whose text (digits aside) comes back on many pages.
 */
export function findRunningLines(pages: PdfPageText[], minShare = 0.25, minPages = 3): Set<string> {
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines) {
      if (!isInMarginZone(line, page)) continue;
      const key = marginKey(line.text);
      if (!key || key === '#') continue;
      if (!counts.has(key)) counts.set(key, new Set());
      counts.get(key)!.add(page.index);
    }
  }
  const threshold = Math.max(minPages, Math.ceil(pages.length * minShare));
  const keys = new Set<string>();
  for (const [key, seen] of counts) {
    if (seen.size >= threshold) keys.add(key);
  }
  return keys;
}

/** Body font size: the most common size, weighted by characters. */
export function computeStats(pages: PdfPageText[]): LayoutStats {
  const weights = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const size = Math.round(line.fontSize * 2) / 2;
      weights.set(size, (weights.get(size) ?? 0) + line.text.length);
    }
  }
  let bodySize = 10;
  let best = -1;
  for (const [size, w] of weights) {
    if (w > best) {
      best = w;
      bodySize = size;
    }
  }
  // Text block edges, from the pages that have enough body lines: a title page
  // or a chapter opening has too few lines to tell where its margins are.
  // Left edges are kept apart for even and odd pages: printed books mirror
  // their margins.
  const lefts: number[] = [];
  const leftsByParity: [number[], number[]] = [[], []];
  const rights: number[] = [];
  for (const page of pages) {
    const body = page.lines.filter((l) => Math.abs(l.fontSize - bodySize) <= bodySize * 0.15);
    if (body.length < 5) continue;
    const left = percentile(
      body.map((l) => l.x),
      0.1,
    );
    lefts.push(left);
    leftsByParity[page.index % 2]!.push(left);
    rights.push(
      percentile(
        body.map((l) => l.xEnd),
        0.9,
      ),
    );
  }
  if (!lefts.length) return { bodySize };
  const all = median(lefts);
  return {
    bodySize,
    left: all,
    right: median(rights),
    leftByParity: [
      leftsByParity[0].length ? median(leftsByParity[0]) : all,
      leftsByParity[1].length ? median(leftsByParity[1]) : all,
    ],
  };
}

/**
 * Joins two lines of the same paragraph, removing the hyphen of a word split
 * across the line break ("exam-" + "ple" -> "example").
 */
export function joinLineText(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  if (prev.endsWith('­')) return prev.slice(0, -1) + next;
  if (HYPHEN_AT_END.test(prev) && STARTS_LOWERCASE.test(next)) return prev.slice(0, -1) + next;
  if (/[—–/]$/.test(prev)) return prev + next;
  return `${prev} ${next}`;
}

const headingLevel = (fontSize: number, bodySize: number): 1 | 2 | 3 | 0 => {
  const ratio = fontSize / bodySize;
  if (ratio >= 1.75) return 1;
  if (ratio >= 1.35) return 2;
  if (ratio >= 1.18) return 3;
  return 0;
};

export const blockText = (block: PdfBlock): string =>
  block.kind === 'image' ? '' : block.segments.map((s) => s.text).join('');

/**
 * Appends a line to a block, joining across the line break. When the line
 * comes from another page, it opens a new segment so the page keeps an anchor.
 */
const appendText = (block: { segments: PdfSegment[] }, text: string, page: number) => {
  const last = block.segments[block.segments.length - 1];
  if (!last) {
    block.segments.push({ text, page });
    return;
  }
  // joinLineText always ends with `text` verbatim (after a space, a dash, or in
  // place of the hyphen it removed), so the seam is exactly `text.length` from the end.
  const joined = joinLineText(last.text, text);
  if (last.page === page) {
    last.text = joined;
    return;
  }
  const keep = joined.length - text.length;
  last.text = joined.slice(0, keep);
  block.segments.push({ text: joined.slice(keep), page });
};

/**
 * Turns the lines of one page into headings and paragraphs.
 * `isMargin` tells which lines are running heads, feet or page numbers.
 */
export function pageToBlocks(
  page: PdfPageText,
  stats: LayoutStats,
  isMargin: (line: PdfLine, page: PdfPageText) => boolean,
): PdfBlock[] {
  const lines = page.lines.filter((line) => !isMargin(line, page));
  if (lines.length === 0) return [];
  const body = stats.bodySize || 10;

  const bodyLines = lines.filter((l) => Math.abs(l.fontSize - body) <= body * 0.15);
  const ref = bodyLines.length >= 3 ? bodyLines : lines;
  // With few lines on the page, the document's usual margins are more reliable.
  const fewLines = bodyLines.length < 5 && stats.left !== undefined && stats.right !== undefined;
  const usualLeft = stats.leftByParity?.[page.index % 2] ?? stats.left;
  const localLeft = percentile(
    ref.map((l) => l.x),
    0.1,
  );
  // A page of one-line paragraphs (dialogue) has every line indented: its
  // lines all seem to start at the margin. Trust the usual margin then.
  const allIndented =
    usualLeft !== undefined &&
    localLeft - usualLeft > body * 0.6 &&
    localLeft - usualLeft < body * 6;
  const left = fewLines ? stats.left! : allIndented ? usualLeft! : localLeft;
  const right = fewLines
    ? stats.right!
    : percentile(
        ref.map((l) => l.xEnd),
        0.9,
      );
  const gaps: number[] = [];
  for (let i = 1; i < bodyLines.length; i++) {
    const gap = bodyLines[i]!.y - bodyLines[i - 1]!.y;
    if (gap > body * 0.6 && gap < body * 3) gaps.push(gap);
  }
  const lineGap = median(gaps) || body * 1.25;

  const blocks: PdfBlock[] = [];
  let current: PdfBlock | null = null;
  let prev: PdfLine | null = null;
  // A drop cap is a big first letter painted on its own: it belongs to the
  // word that follows ("T" + "he story begins").
  let dropCap = '';

  const isCentered = (l: PdfLine) => {
    const leftSpace = l.x - left;
    const rightSpace = right - l.xEnd;
    return (
      leftSpace > body * 2 &&
      rightSpace > body * 2 &&
      Math.abs(leftSpace - rightSpace) < Math.max(body * 2, (right - left) * 0.08)
    );
  };

  for (const rawLine of lines) {
    const level = headingLevel(rawLine.fontSize, body);
    if (level && /^\p{Lu}$/u.test(rawLine.text.trim())) {
      dropCap += rawLine.text.trim();
      continue;
    }
    const line = dropCap ? { ...rawLine, text: dropCap + rawLine.text } : rawLine;
    const hadDropCap = !!dropCap;
    dropCap = '';
    const shortLine = line.text.length < 160;
    const gapBefore = prev ? line.y - prev.y : Infinity;

    if (level && shortLine && !hadDropCap) {
      const sameHeading =
        current?.kind === 'heading' &&
        prev &&
        Math.abs(prev.fontSize - line.fontSize) <= line.fontSize * 0.12 &&
        gapBefore < line.fontSize * 2.2;
      if (sameHeading && current && current.kind === 'heading') {
        appendText(current, line.text, page.index);
      } else {
        current = { kind: 'heading', level, segments: [{ text: line.text, page: page.index }] };
        blocks.push(current);
      }
      prev = line;
      continue;
    }

    const centered = isCentered(line);
    const indent = line.x - left;
    const indented = indent > line.fontSize * 0.8 && indent < line.fontSize * 8 && !centered;
    const list = LIST_MARKER.test(line.text);
    const boldStandalone =
      line.bold && line.text.length < 90 && !TERMINAL_PUNCTUATION.test(line.text) && !prev?.bold;

    let startNew = !current || current.kind !== 'paragraph' || !prev || hadDropCap;
    if (!startNew && prev && current && current.kind === 'paragraph') {
      const bigGap = gapBefore > lineGap * 1.45 || gapBefore < 0;
      const width = right - left;
      const prevShort = right - prev.xEnd > Math.max(line.fontSize * 3, width * 0.12);
      // Far shorter than a full line: the end of a line of its own (title
      // page, address, contents), even without a full stop.
      const prevVeryShort = right - prev.xEnd > width * 0.25;
      const prevEnded = TERMINAL_PUNCTUATION.test(prev.text);
      const startsUpper = /^[\p{Lu}\d"“«'‘(]/u.test(line.text);
      const prevIndented = prev.x - left > prev.fontSize * 0.8;
      const blockQuote =
        indented && prevIndented && Math.abs(line.x - prev.x) < line.fontSize * 0.25;
      if (bigGap) startNew = true;
      else if (list) startNew = true;
      else if (current.list && prevEnded && startsUpper) startNew = true;
      else if (centered !== !!current.center) startNew = true;
      else if (centered) startNew = (prevEnded && prevShort) || (prevVeryShort && startsUpper);
      // An indented line opens a paragraph, unless it carries on an indented
      // quotation mid-sentence; after a full stop, a capital starts a new one
      // (one-line replies in a dialogue all share the same indent).
      else if (indented && (!blockQuote || (prevEnded && startsUpper))) startNew = true;
      else if (prevShort && prevEnded) startNew = true;
      else if (prevVeryShort && startsUpper) startNew = true;
      else if (boldStandalone) startNew = true;
    }

    if (boldStandalone && (!prev || gapBefore > lineGap * 1.2)) {
      current = { kind: 'heading', level: 3, segments: [{ text: line.text, page: page.index }] };
      blocks.push(current);
      prev = line;
      continue;
    }

    if (startNew || !current || current.kind !== 'paragraph') {
      current = {
        kind: 'paragraph',
        segments: [{ text: line.text, page: page.index }],
        ...(centered ? { center: true } : {}),
        ...(list ? { list: true } : {}),
        ...(indented ? { indented: true } : {}),
      };
      blocks.push(current);
    } else {
      appendText(current, line.text, page.index);
    }
    prev = line;
  }
  return blocks;
}

/**
 * Whether the first block of a page continues the last paragraph of the
 * previous page: the paragraph had not ended, and the new page does not open
 * with an indent, a heading, a list item or a centred line.
 */
export function continuesAcrossPages(
  prevBlock: PdfBlock | undefined,
  nextBlock: PdfBlock | undefined,
): boolean {
  if (!prevBlock || !nextBlock) return false;
  if (prevBlock.kind !== 'paragraph' || nextBlock.kind !== 'paragraph') return false;
  if (prevBlock.center || nextBlock.center || nextBlock.list || nextBlock.indented) return false;
  const prevText = blockText(prevBlock);
  const nextText = blockText(nextBlock);
  if (!prevText || !nextText) return false;
  if (!TERMINAL_PUNCTUATION.test(prevText)) return true;
  // A sentence can end exactly at the bottom of a page; only a lowercase start
  // proves the paragraph goes on.
  return STARTS_LOWERCASE.test(nextText);
}

/** Merges `next` (a paragraph) into `prev` (the paragraph it continues). */
export function mergeBlocks(prev: PdfBlock, next: PdfBlock): void {
  if (prev.kind !== 'paragraph' || next.kind !== 'paragraph') return;
  const [first, ...rest] = next.segments;
  if (!first) return;
  appendText(prev, first.text, first.page);
  prev.segments.push(...rest.map((s) => ({ ...s })));
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const pageAnchorId = (page: number) => `pdf-page-${page}`;

/** Id of the n-th heading (0-based) found on a PDF page, for the table of contents. */
export const headingAnchorId = (page: number, n: number) => `pdf-h-${page}-${n}`;

/**
 * Version of the reading layout. Raise it when the rebuilt text changes
 * shape (headings found, paragraphs cut), so saved tables of contents built
 * from an older layout are not reused.
 */
export const PDF_TEXT_LAYOUT_VERSION = 1;

const anchorHtml = (page: number) =>
  `<span class="pdf-page" id="${pageAnchorId(page)}" data-page="${page + 1}"></span>`;

export interface HtmlOptions {
  lang?: string;
  dir?: string;
  title?: string;
  /** Pages of the section, so that every page gets an anchor even when blank. */
  pages: number[];
}

const STYLE = `
p { margin: 0; text-indent: 1.5em; }
h1 + p, h2 + p, h3 + p, figure + p, p.pdf-center + p, body > p:first-child, p.pdf-list { text-indent: 0; }
p.pdf-center { text-align: center; text-indent: 0; margin: 0.6em 0; }
p.pdf-list { margin: 0.15em 0; }
h1, h2, h3 { text-indent: 0; line-height: 1.3; }
h1, h2 { break-before: column; -webkit-column-break-before: always; }
h1 + h1, h1 + h2, h2 + h1, h2 + h2, body > :first-child {
  break-before: auto; -webkit-column-break-before: auto;
}
h1 { font-size: 1.6em; margin: 1.2em 0 0.8em; }
h2 { font-size: 1.3em; margin: 1.1em 0 0.6em; }
h3 { font-size: 1.1em; margin: 1em 0 0.4em; }
figure.pdf-figure { margin: 1em 0; text-align: center; }
figure.pdf-figure img { max-width: 100%; height: auto; }
`;

/** Writes the blocks of a section as a standalone HTML document. */
export function blocksToHtml(blocks: PdfBlock[], options: HtmlOptions): string {
  const anchored = new Set<number>();
  const pending = [...options.pages].sort((a, b) => a - b);
  const parts: string[] = [];

  // Anchors of pages that produced no text are attached before the next block.
  const flushAnchorsBefore = (page: number) => {
    let html = '';
    while (pending.length && pending[0]! <= page) {
      const p = pending.shift()!;
      if (!anchored.has(p)) {
        anchored.add(p);
        html += anchorHtml(p);
      }
    }
    return html;
  };

  // Headings are numbered page by page, like scanHeadings does, so the table
  // of contents lands on the heading itself.
  const headingsOnPage = new Map<number, number>();

  for (const block of blocks) {
    if (block.kind === 'image') {
      const anchors = flushAnchorsBefore(block.page);
      parts.push(
        `<figure class="pdf-figure">${anchors}<img src="${escapeHtml(block.src)}" alt=""/></figure>`,
      );
      continue;
    }
    let inner = '';
    for (const segment of block.segments) {
      inner += flushAnchorsBefore(segment.page);
      inner += escapeHtml(segment.text);
    }
    if (block.kind === 'heading') {
      const page = block.segments[0]?.page ?? 0;
      const n = headingsOnPage.get(page) ?? 0;
      headingsOnPage.set(page, n + 1);
      parts.push(`<h${block.level} id="${headingAnchorId(page, n)}">${inner}</h${block.level}>`);
    } else {
      const classes = [block.center ? 'pdf-center' : '', block.list ? 'pdf-list' : '']
        .filter(Boolean)
        .join(' ');
      parts.push(classes ? `<p class="${classes}">${inner}</p>` : `<p>${inner}</p>`);
    }
  }
  const trailing = flushAnchorsBefore(Number.MAX_SAFE_INTEGER);
  if (trailing) parts.push(`<p class="pdf-center">${trailing}</p>`);

  const lang = options.lang ? ` lang="${escapeHtml(options.lang)}"` : '';
  const dir = options.dir ? ` dir="${escapeHtml(options.dir)}"` : '';
  const title = escapeHtml(options.title ?? '');
  return `<!DOCTYPE html>
<html${lang}${dir}>
<head><meta charset="utf-8"/><title>${title}</title><style>${STYLE}</style></head>
<body>
${parts.join('\n')}
</body>
</html>`;
}
