/**
 * "Text mode" for PDFs: builds a reflowable book out of a PDF, so that the
 * reader treats it exactly like an EPUB (fonts, themes, pagination,
 * translation, read aloud, search, highlights).
 *
 * Each section is a chapter (from the PDF outline) or a run of pages, rebuilt
 * as clean HTML: paragraphs, headings, no running heads or page numbers.
 * Every PDF page leaves an anchor (`#pdf-page-N`) so the table of contents and
 * the switch between page mode and text mode land on the same spot.
 */
import type { BookDoc, SectionItem, TOCItem } from '@/libs/document';
import {
  blocksToHtml,
  blockText,
  computeStats,
  continuesAcrossPages,
  findRunningLines,
  isInMarginZone,
  isPageNumber,
  LayoutStats,
  marginKey,
  mergeBlocks,
  headingAnchorId,
  pageAnchorId,
  pageToBlocks,
  PdfBlock,
  PdfLine,
  PdfPageText,
  PdfTextRun,
  runsToLines,
} from './layout';
import { detectLanguage, isRtlLanguage } from './language';

/* ----- the parts of pdf.js used here (a fake can stand in for tests) ----- */

export interface PdfViewportLike {
  width: number;
  height: number;
  convertToViewportPoint?(x: number, y: number): number[];
}

export interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
  dir?: string;
}

export interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  getTextContent(): Promise<{
    items: PdfTextItemLike[];
    styles?: Record<string, { fontFamily?: string }>;
  }>;
  cleanup?(): void;
  commonObjs?: { has(id: string): boolean; get(id: string): unknown };
}

interface OutlineItem {
  title: string;
  dest?: string | unknown[] | null;
  items?: OutlineItem[];
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getMetadata?(): Promise<{
    info?: Record<string, unknown>;
    metadata?: { get(key: string): unknown } | null;
  } | null>;
  getOutline?(): Promise<OutlineItem[] | null>;
  getDestination?(name: string): Promise<unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
  destroy?(): unknown;
}

export interface PdfTextBookOptions {
  /** Renders a page as an image URL (covers, full-page pictures); null for a blank page. */
  renderPageImage?: (page: PdfPageLike, index: number) => Promise<string | null>;
  renderCover?: (page: PdfPageLike) => Promise<Blob | null>;
  revokeUrl?: (url: string) => void;
  createUrl?: (html: string) => string;
}

/** A heading found in the rebuilt text: the n-th heading (0-based) of its page. */
export interface PdfHeadingEntry {
  label: string;
  page: number;
  n: number;
  level: 1 | 2 | 3;
}

export interface PdfTextBookDoc extends BookDoc {
  isPdfText: true;
  /** First PDF page (0-based) of each section. */
  pdfSectionStarts: number[];
  pageToSection(page: number): number;
  resolveHref(href: string): { index: number; anchor?: (doc: Document) => Element | null } | null;
  getTOCFragment(doc: Document, id: string): Element | null;
  isExternal(uri: string): boolean;
  /**
   * Reads every page, gently, and lists the headings of the rebuilt text: the
   * table of contents of a PDF that has no bookmarks. Runs once per book.
   */
  scanHeadings(options?: {
    onProgress?: (done: number, total: number) => void;
  }): Promise<PdfHeadingEntry[]>;
  /** Turns headings into a table of contents pointing at this book's sections. */
  headingToc(entries: PdfHeadingEntry[]): TOCItem[];
  destroy(): void;
}

/**
 * Builds a table of contents from the headings of a PDF without bookmarks.
 * The chapter level is the highest heading level used at least twice (a lone
 * title heading stays alongside); the next level used below it becomes
 * sub-entries.
 */
export function buildHeadingToc(
  entries: PdfHeadingEntry[],
  pageToSection: (page: number) => number,
): TOCItem[] {
  const clean = entries.filter(
    (e) => e.label.length >= 2 && e.label.length <= 120 && /\p{L}/u.test(e.label),
  );
  const deduped = clean.filter((e, i) => i === 0 || e.label !== clean[i - 1]!.label);
  if (!deduped.length) return [];
  const counts = new Map<number, number>();
  for (const e of deduped) counts.set(e.level, (counts.get(e.level) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  const top = levels.find((l) => (counts.get(l) ?? 0) >= 2) ?? levels[0]!;
  // The next level used below the chapters, whatever its number.
  const childLevel = levels.find((l) => l > top);
  // A table of contents with hundreds of chapters keeps only the chapters.
  const withChildren = deduped.filter((e) => e.level <= top).length <= 400;
  let id = 0;
  const make = (e: PdfHeadingEntry) =>
    ({
      id: id++,
      label: e.label,
      href: `${sectionId(pageToSection(e.page))}#${headingAnchorId(e.page, e.n)}`,
      index: e.page,
    }) as TOCItem;
  const toc: TOCItem[] = [];
  let parent: TOCItem | null = null;
  for (const e of deduped) {
    if (e.level <= top) {
      parent = make(e);
      toc.push(parent);
    } else if (e.level === childLevel && withChildren) {
      const child = make(e);
      if (parent) (parent.subitems ??= []).push(child);
      else toc.push(child);
    }
  }
  return toc;
}

/** Longest run of pages in one section; chapters longer than that are split. */
export const MAX_PAGES_PER_SECTION = 16;
const SAMPLE_SIZE = 16;
const NEIGHBOR_WINDOW = 3;
/**
 * A page with fewer characters than this may be a picture (cover, plate): it
 * is drawn, and shown as an image if it holds more than a few words on white.
 */
const IMAGE_PAGE_MAX_CHARS = 40;
const PAGE_CACHE_SIZE = 64;
const SECTION_CACHE_SIZE = 6;

export const sectionId = (index: number) => `pdf-section-${index}`;

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Splits the pages into sections: one per chapter, long chapters cut in even runs. */
export function computeSectionStarts(numPages: number, chapterStarts: number[]): number[] {
  if (numPages <= 0) return [0];
  const starts = new Set<number>([0]);
  for (const p of chapterStarts) if (Number.isInteger(p) && p > 0 && p < numPages) starts.add(p);
  const sorted = [...starts].sort((a, b) => a - b);
  const result = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    const end = sorted[i + 1] ?? numPages;
    const length = end - start;
    const parts = Math.max(1, Math.ceil(length / MAX_PAGES_PER_SECTION));
    for (let k = 0; k < parts; k++) result.add(start + Math.round((k * length) / parts));
  }
  return [...result].sort((a, b) => a - b);
}

const samplePageIndexes = (numPages: number): number[] => {
  if (numPages <= SAMPLE_SIZE) return Array.from({ length: numPages }, (_, i) => i);
  const set = new Set<number>();
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    set.add(Math.min(numPages - 1, Math.floor(((i + 0.5) * numPages) / SAMPLE_SIZE)));
  }
  return [...set];
};

const fontStyle = (
  page: PdfPageLike,
  fontName: string,
  styles?: Record<string, { fontFamily?: string }>,
) => {
  let name = '';
  try {
    if (fontName && page.commonObjs?.has(fontName)) {
      const font = page.commonObjs.get(fontName) as { name?: string } | undefined;
      name = font?.name ?? '';
    }
  } catch {
    // Font not transferred to this thread: style stays unknown.
  }
  const family = styles?.[fontName]?.fontFamily ?? '';
  const n = `${name} ${family}`.toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demibold/.test(n),
    italic: /italic|oblique/.test(n),
  };
};

/** Reads the text runs of a page, in top-left coordinates. */
export async function readPageText(page: PdfPageLike, index: number): Promise<PdfPageText> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: PdfTextRun[] = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.transform) continue;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    const point = viewport.convertToViewportPoint
      ? viewport.convertToViewportPoint(e, f)
      : [e, viewport.height - f];
    runs.push({
      str: item.str,
      x: point[0] ?? e,
      y: point[1] ?? viewport.height - f,
      width: item.width ?? 0,
      fontSize,
      hasEOL: item.hasEOL,
      dir: item.dir,
      ...fontStyle(page, item.fontName ?? '', content.styles),
    });
  }
  return { index, width: viewport.width, height: viewport.height, lines: runsToLines(runs) };
}

class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(
    private limit: number,
    private onEvict?: (value: V) => void,
  ) {}
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value as K;
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      if (evicted !== undefined) this.onEvict?.(evicted);
    }
  }
  values() {
    return this.map.values();
  }
  clear() {
    this.map.clear();
  }
}

const cloneBlocks = (blocks: PdfBlock[]): PdfBlock[] =>
  blocks.map((b) =>
    b.kind === 'image' ? { ...b } : { ...b, segments: b.segments.map((s) => ({ ...s })) },
  );

const lastSegmentPage = (block: PdfBlock | undefined): number | undefined => {
  if (!block) return undefined;
  if (block.kind === 'image') return block.page;
  return block.segments[block.segments.length - 1]?.page;
};

export async function buildPdfTextBook(
  pdf: PdfDocumentLike,
  options: PdfTextBookOptions = {},
): Promise<PdfTextBookDoc> {
  const numPages = pdf.numPages;
  const createUrl =
    options.createUrl ??
    ((html: string) => URL.createObjectURL(new Blob([html], { type: 'text/html' })));
  const revokeUrl = options.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));

  /* ----- pages ----- */
  const pageTexts = new Lru<number, Promise<PdfPageText>>(PAGE_CACHE_SIZE);
  const readPage = (index: number): Promise<PdfPageText> => {
    const cached = pageTexts.get(index);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const page = await pdf.getPage(index + 1);
        const text = await readPageText(page, index);
        page.cleanup?.();
        return text;
      } catch (e) {
        console.warn('PDF text mode: could not read page', index + 1, e);
        return { index, width: 1, height: 1, lines: [] as PdfLine[] };
      }
    })();
    pageTexts.set(index, promise);
    return promise;
  };

  /* ----- metadata ----- */
  const meta = (await pdf.getMetadata?.().catch(() => null)) ?? null;
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  const xmp = meta?.metadata ?? null;
  const fromXmp = (key: string) => {
    try {
      return xmp?.get(key);
    } catch {
      return undefined;
    }
  };

  /* ----- layout statistics, running heads, language (from a sample of pages) ----- */
  const samples = await Promise.all(samplePageIndexes(numPages).map(readPage));
  const stats: LayoutStats = computeStats(samples);
  const runningKeys = findRunningLines(samples);

  let language = asText(fromXmp('dc:language')) ?? asText(info['Language']) ?? '';
  if (!language) {
    const sampleText = samples
      .flatMap((page) => page.lines.filter((l) => !isInMarginZone(l, page)).map((l) => l.text))
      .join(' ');
    language = detectLanguage(sampleText);
  }
  const dir = language && isRtlLanguage(language) ? 'rtl' : 'ltr';

  /* ----- sections from the outline ----- */
  const outline = (await pdf.getOutline?.().catch(() => null)) ?? null;
  const pageOfDest = async (dest: OutlineItem['dest']): Promise<number | undefined> => {
    if (!dest) return undefined;
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination?.(dest) : dest;
      const target = explicit?.[0];
      if (typeof target === 'number') return target;
      if (target && pdf.getPageIndex) return await pdf.getPageIndex(target);
    } catch (e) {
      console.warn('PDF text mode: unresolved outline destination', e);
    }
    return undefined;
  };

  type ResolvedItem = { label: string; page?: number; items: ResolvedItem[] };
  const resolveOutline = async (items: OutlineItem[]): Promise<ResolvedItem[]> =>
    Promise.all(
      items.map(async (item) => ({
        label: item.title?.trim() || '',
        page: await pageOfDest(item.dest),
        items: item.items?.length ? await resolveOutline(item.items) : [],
      })),
    );
  const resolvedOutline = outline ? await resolveOutline(outline) : [];

  // A single top-level entry usually wraps the whole book: its children are the chapters.
  const chapterLevel =
    resolvedOutline.length === 1 && resolvedOutline[0]!.items.length > 1
      ? resolvedOutline[0]!.items
      : resolvedOutline;
  const chapterStarts = chapterLevel
    .map((item) => item.page)
    .filter((p): p is number => typeof p === 'number');
  const starts = computeSectionStarts(numPages, chapterStarts);

  const pageToSection = (page: number): number => {
    let index = 0;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i]! <= page) index = i;
      else break;
    }
    return index;
  };
  const sectionEnd = (index: number) => starts[index + 1] ?? numPages;

  /* ----- per-page blocks ----- */
  const marginPredicateFor = async (index: number) => {
    const neighborCounts = new Map<string, number>();
    const neighbors: number[] = [];
    for (let q = index - NEIGHBOR_WINDOW; q <= index + NEIGHBOR_WINDOW; q++) {
      if (q !== index && q >= 0 && q < numPages) neighbors.push(q);
    }
    const neighborPages = await Promise.all(neighbors.map(readPage));
    for (const page of neighborPages) {
      const seen = new Set<string>();
      for (const line of page.lines) {
        if (!isInMarginZone(line, page)) continue;
        const key = marginKey(line.text);
        if (seen.has(key)) continue;
        seen.add(key);
        neighborCounts.set(key, (neighborCounts.get(key) ?? 0) + 1);
      }
    }
    return (line: PdfLine, page: PdfPageText) => {
      if (!isInMarginZone(line, page)) return false;
      if (isPageNumber(line.text)) return true;
      const key = marginKey(line.text);
      return runningKeys.has(key) || (neighborCounts.get(key) ?? 0) >= 2;
    };
  };

  const imageUrls = new Map<number, Promise<string | null>>();
  const pageImage = (index: number): Promise<string | null> => {
    if (!options.renderPageImage) return Promise.resolve(null);
    let promise = imageUrls.get(index);
    if (!promise) {
      promise = pdf
        .getPage(index + 1)
        .then((page) => options.renderPageImage!(page, index))
        .catch(() => null);
      imageUrls.set(index, promise);
    }
    return promise;
  };

  const pageBlocks = new Lru<number, Promise<PdfBlock[]>>(PAGE_CACHE_SIZE);
  const blocksForPage = async (index: number): Promise<PdfBlock[]> => {
    let promise = pageBlocks.get(index);
    if (!promise) {
      promise = (async () => {
        const page = await readPage(index);
        const isMargin = await marginPredicateFor(index);
        const textChars = page.lines
          .filter((l) => !isMargin(l, page))
          .reduce((n, l) => n + l.text.length, 0);
        if (textChars < IMAGE_PAGE_MAX_CHARS) {
          const src = await pageImage(index);
          if (src) return [{ kind: 'image', page: index, src } as PdfBlock];
        }
        return pageToBlocks(page, stats, isMargin);
      })();
      pageBlocks.set(index, promise);
    }
    return cloneBlocks(await promise);
  };

  /* ----- sections ----- */
  const title = asText(fromXmp('dc:title')) ?? asText(info['Title']) ?? '';

  const buildSectionHtml = async (index: number): Promise<string> => {
    const start = starts[index]!;
    const end = sectionEnd(index);
    // Read the pages and their neighbours in one go: pdf.js serves them faster.
    await Promise.all(
      Array.from(
        {
          length:
            Math.min(numPages, end + NEIGHBOR_WINDOW + 1) -
            Math.max(0, start - NEIGHBOR_WINDOW - 1),
        },
        (_, i) => readPage(Math.max(0, start - NEIGHBOR_WINDOW - 1) + i),
      ),
    );

    const blocks: PdfBlock[] = [];
    for (let p = start; p < end; p++) {
      const own = await blocksForPage(p);
      let first = 0;
      if (p === start && start > 0) {
        // The head of this section may finish a paragraph begun on the
        // previous page; that paragraph was completed in the previous section.
        const previous = await blocksForPage(start - 1);
        if (continuesAcrossPages(previous[previous.length - 1], own[0])) first = 1;
      }
      for (let i = first; i < own.length; i++) {
        const block = own[i]!;
        const last = blocks[blocks.length - 1];
        if (i === first && last && continuesAcrossPages(last, block)) mergeBlocks(last, block);
        else blocks.push(block);
      }
    }
    // The last paragraph may go on at the top of the next section's first page.
    if (end < numPages) {
      const last = blocks[blocks.length - 1];
      const next = await blocksForPage(end);
      if (lastSegmentPage(last) === end - 1 && last && continuesAcrossPages(last, next[0])) {
        mergeBlocks(last, next[0]!);
      }
    }
    const pages = Array.from({ length: end - start }, (_, i) => start + i);
    return blocksToHtml(blocks, { lang: language || undefined, dir, title, pages });
  };

  const sectionHtml = new Lru<number, Promise<string>>(SECTION_CACHE_SIZE);
  const getSectionHtml = (index: number): Promise<string> => {
    let promise = sectionHtml.get(index);
    if (!promise) {
      promise = buildSectionHtml(index);
      sectionHtml.set(index, promise);
    }
    return promise;
  };

  const sectionUrls = new Lru<number, string>(SECTION_CACHE_SIZE, revokeUrl);
  const prefetch = (index: number) => {
    if (index < 0 || index >= starts.length) return;
    setTimeout(() => {
      getSectionHtml(index).catch(() => {});
    }, 400);
  };

  const sections: SectionItem[] = starts.map((start, index) => {
    const pagesInSection = sectionEnd(index) - start;
    // No `cfi` on purpose: foliate then builds index-based CFIs, as for FB2.
    return {
      id: sectionId(index),
      size: pagesInSection * 2500,
      linear: 'yes',
      load: async () => {
        const cached = sectionUrls.get(index);
        if (cached) return cached;
        const url = createUrl(await getSectionHtml(index));
        sectionUrls.set(index, url);
        prefetch(index + 1);
        return url;
      },
      unload: () => {},
      loadText: () => getSectionHtml(index),
      createDocument: async () =>
        new DOMParser().parseFromString(await getSectionHtml(index), 'text/html'),
    } as unknown as SectionItem;
  });

  /* ----- table of contents ----- */
  let tocId = 0;
  const toTocItems = (items: ResolvedItem[]): TOCItem[] =>
    items.map((item) => {
      const page = item.page;
      const href =
        typeof page === 'number' ? `${sectionId(pageToSection(page))}#${pageAnchorId(page)}` : '';
      // `index` is the original page number shown beside the entry.
      return {
        id: tocId++,
        label: item.label,
        href,
        ...(typeof page === 'number' ? { index: page } : {}),
        subitems: item.items.length ? toTocItems(item.items) : undefined,
      } as TOCItem;
    });
  const toc = toTocItems(resolvedOutline);

  /* ----- headings, for PDFs without bookmarks ----- */
  let destroyed = false;
  let scan: Promise<PdfHeadingEntry[]> | null = null;
  const scanHeadings: PdfTextBookDoc['scanHeadings'] = (scanOptions = {}) => {
    if (!scan) {
      scan = (async () => {
        const entries: PdfHeadingEntry[] = [];
        for (let p = 0; p < numPages && !destroyed; p++) {
          const page = await readPage(p);
          if (page.lines.length) {
            // Numbered exactly as blocksToHtml numbers them.
            let n = 0;
            for (const block of await blocksForPage(p)) {
              if (block.kind !== 'heading') continue;
              entries.push({
                label: blockText(block).replace(/\s+/g, ' ').trim(),
                page: p,
                n: n++,
                level: block.level,
              });
            }
          }
          scanOptions.onProgress?.(p + 1, numPages);
          // Let the reader breathe between pages.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return entries;
      })();
    }
    return scan;
  };

  /* ----- navigation ----- */
  // pdf-section-3, #pdf-page-27, pdf-section-3#pdf-page-27, pdf-section-3#pdf-h-27-0
  const HREF = /^(?:pdf-section-(\d+))?(?:#(pdf-page-(\d+)|pdf-h-(\d+)-(\d+)))?$/;
  const resolveHref = (href: string) => {
    const m = HREF.exec(href ?? '');
    if (!m || (m[1] === undefined && m[2] === undefined)) return null;
    const fragment = m[2];
    const pageText = m[3] ?? m[4];
    const page = pageText !== undefined ? Number(pageText) : undefined;
    const index = m[1] !== undefined ? Number(m[1]) : pageToSection(page!);
    if (index < 0 || index >= starts.length) return null;
    if (!fragment) return { index };
    const pageAnchor = page !== undefined ? pageAnchorId(page) : null;
    return {
      index,
      anchor: (doc: Document) =>
        doc.getElementById(fragment) ?? (pageAnchor ? doc.getElementById(pageAnchor) : null),
    };
  };

  const book: PdfTextBookDoc = {
    isPdfText: true,
    pdfSectionStarts: starts,
    pageToSection,
    metadata: {
      title,
      author: asText(fromXmp('dc:creator')) ?? asText(info['Author']) ?? '',
      language,
      description: asText(fromXmp('dc:description')) ?? asText(info['Subject']),
      publisher: asText(fromXmp('dc:publisher')),
      identifier: asText(fromXmp('dc:identifier')),
    },
    rendition: { layout: 'reflowable' },
    dir,
    toc,
    sections,
    resolveHref,
    splitTOCHref: (href: string) => {
      const resolved = href ? resolveHref(href) : null;
      if (!resolved) return [null, null] as unknown as Array<string | number>;
      const m = HREF.exec(href);
      return [sectionId(resolved.index), m?.[2] ?? null] as Array<string | number>;
    },
    scanHeadings,
    headingToc: (entries: PdfHeadingEntry[]) => buildHeadingToc(entries, pageToSection),
    getTOCFragment: (doc: Document, id: string) => doc.getElementById(id),
    isExternal: (uri: string) => /^\w+:/i.test(uri),
    getCover: async () => {
      if (!options.renderCover) return null;
      try {
        return await options.renderCover(await pdf.getPage(1));
      } catch {
        return null;
      }
    },
    destroy: () => {
      destroyed = true;
      for (const url of sectionUrls.values()) revokeUrl(url);
      sectionUrls.clear();
      sectionHtml.clear();
      pageBlocks.clear();
      pageTexts.clear();
      for (const promise of imageUrls.values()) {
        promise.then((url) => url && revokeUrl(url)).catch(() => {});
      }
      imageUrls.clear();
      pdf.destroy?.();
    },
  };
  return book;
}

/* ----- the browser side: pdf.js, canvases ----- */

const pdfjsPath = (path: string) => `/vendor/pdfjs/${path}`;
// Same throttle as foliate-js/pdf.js: native file schemes have no connection limit.
const MAX_CONCURRENT_RANGES = 6;

type PdfjsLib = {
  PDFDataRangeTransport: new (
    length: number,
    initialData: unknown[],
  ) => {
    requestDataRange: (begin: number, end: number) => void;
    onDataRange: (begin: number, chunk: ArrayBuffer) => void;
  };
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocumentLike> };
};

const openPdf = async (pdfjsLib: PdfjsLib, file: File): Promise<PdfDocumentLike> => {
  const transport = new pdfjsLib.PDFDataRangeTransport(file.size, []);
  let active = 0;
  const queue: Array<[number, number]> = [];
  const pump = () => {
    while (active < MAX_CONCURRENT_RANGES && queue.length) {
      const [begin, end] = queue.shift()!;
      active++;
      file
        .slice(begin, end)
        .arrayBuffer()
        .then((chunk) => transport.onDataRange(begin, chunk))
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  transport.requestDataRange = (begin: number, end: number) => {
    queue.push([begin, end]);
    pump();
  };
  return pdfjsLib.getDocument({
    range: transport,
    wasmUrl: pdfjsPath(''),
    cMapUrl: pdfjsPath('cmaps/'),
    standardFontDataUrl: pdfjsPath('standard_fonts/'),
    isEvalSupported: false,
  }).promise;
};

type RenderablePage = PdfPageLike & {
  getViewport(params: { scale: number }): PdfViewportLike;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
    promise: Promise<void>;
  };
};

const renderToCanvas = async (page: PdfPageLike, maxWidth: number) => {
  const renderable = page as RenderablePage;
  if (typeof renderable.render !== 'function') return null;
  const base = renderable.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidth / base.width);
  const viewport = renderable.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await renderable.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
};

/** Share of the page that is not white (0-1), measured on a thumbnail. */
const inkRatio = (canvas: HTMLCanvasElement) => {
  const small = document.createElement('canvas');
  small.width = 48;
  small.height = 64;
  const ctx = small.getContext('2d');
  if (!ctx) return 1;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);
  let inked = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! < 240 || data[i + 1]! < 240 || data[i + 2]! < 240) inked++;
  }
  return inked / (small.width * small.height);
};

/**
 * Below this, a page with little text is only words on white (a chapter
 * opening, a dedication): it stays text, so it can be translated and listed
 * in the table of contents. Above it, it is a picture (cover, plate).
 */
const PICTURE_MIN_INK = 0.06;

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));

const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

export const makePDFTextBook = async (file: File): Promise<PdfTextBookDoc> => {
  // Loading foliate's PDF module sets up pdf.js and its worker.
  await import('foliate-js/pdf.js');
  const pdfjsLib = (globalThis as unknown as { pdfjsLib: PdfjsLib }).pdfjsLib;
  const pdf = await openPdf(pdfjsLib, file);
  const book = await buildPdfTextBook(pdf, {
    renderPageImage: async (page) => {
      const canvas = await renderToCanvas(page, 1200);
      if (!canvas) return null;
      try {
        if (inkRatio(canvas) < PICTURE_MIN_INK) return null;
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
        return blob ? URL.createObjectURL(blob) : null;
      } finally {
        releaseCanvas(canvas);
      }
    },
    renderCover: async (page) => {
      const canvas = await renderToCanvas(page, 900);
      if (!canvas) return null;
      try {
        return await canvasToBlob(canvas, 'image/png');
      } finally {
        releaseCanvas(canvas);
      }
    },
  });
  if (!book.metadata.title) book.metadata.title = file.name.replace(/\.pdf$/i, '');
  return book;
};

export const isPdfTextBook = (book: unknown): book is PdfTextBookDoc =>
  !!book && (book as { isPdfText?: boolean }).isPdfText === true;

/** Text of a block, exported for tests. */
export { blockText };
