import { describe, expect, it } from 'vitest';
import {
  buildPdfTextBook,
  computeSectionStarts,
  MAX_PAGES_PER_SECTION,
  PdfDocumentLike,
  PdfPageLike,
  PdfTextItemLike,
} from '@/libs/pdfText/book';

/**
 * A fake pdf.js document. Coordinates follow the PDF convention (origin at the
 * bottom-left), like real pdf.js text items: the book must flip them.
 */
const PAGE_W = 400;
const PAGE_H = 600;

const item = (
  str: string,
  x: number,
  yFromTop: number,
  size = 10,
  width?: number,
): PdfTextItemLike => ({
  str,
  transform: [size, 0, 0, size, x, PAGE_H - yFromTop],
  width: width ?? str.length * size * 0.5,
  height: size,
  hasEOL: true,
});

const fakePage = (items: PdfTextItemLike[]): PdfPageLike => ({
  getViewport: () => ({ width: PAGE_W, height: PAGE_H }),
  getTextContent: async () => ({ items }),
});

const fakePdf = (
  pages: PdfTextItemLike[][],
  outline: Array<{ title: string; dest: unknown[] }> | null = null,
  info: Record<string, unknown> = {},
): PdfDocumentLike => ({
  numPages: pages.length,
  getPage: async (n) => fakePage(pages[n - 1]!),
  getMetadata: async () => ({ info, metadata: null }),
  getOutline: async () => outline,
  getPageIndex: async (ref) => (ref as { num: number }).num,
});

/** A body line of at least 60 characters is 300 units wide or more: a full, justified line. */
const full = (text: string) => text.padEnd(60, ' ');

let urlCounter = 0;
const options = {
  createUrl: () => `blob:section-${urlCounter++}`,
  revokeUrl: () => {},
};

const englishBody = [
  'The art of reading is the art of listening to the voice of',
  'someone who is not in the room with you, and of hearing what',
];

describe('computeSectionStarts', () => {
  it('starts a section at each chapter and cuts long chapters evenly', () => {
    expect(computeSectionStarts(10, [3, 7])).toEqual([0, 3, 7]);
    const starts = computeSectionStarts(40, []);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeLessThanOrEqual(MAX_PAGES_PER_SECTION);
    }
  });
});

describe('buildPdfTextBook', () => {
  const pages: PdfTextItemLike[][] = [
    // Page 1: chapter title and an unfinished paragraph.
    [
      item('MY BOOK', 160, 30, 8),
      item('Chapter One', 130, 80, 20, 140),
      item(full(englishBody[0]!), 65, 130),
      item(full(englishBody[1]!), 50, 143),
      item(full('they say between the lines of the page, and so the wise reader'), 50, 156),
      item(full('learns to wait for the last word before he judges the first one'), 50, 169),
      item(full('and to read again what he did not understand the first time, in'), 50, 182),
      item('1', 198, 580, 8),
    ],
    // Page 2: the paragraph goes on, then a new one.
    [
      item('MY BOOK', 160, 30, 8),
      item(full('the quiet of the evening, when the house is asleep and the mind'), 50, 100),
      item('is free.', 50, 113, 10, 40),
      item(full('A second paragraph opens here with an indent, as books do, and'), 65, 126),
      item('ends.', 50, 139, 10, 25),
      item('2', 198, 580, 8),
    ],
    // Page 3: a second chapter.
    [
      item('MY BOOK', 160, 30, 8),
      item('Chapter Two', 130, 80, 20, 140),
      item(full('Everything that was said in the first chapter is now forgotten,'), 65, 130),
      item('and that is fine.', 50, 143, 10, 85),
      item('3', 198, 580, 8),
    ],
  ];
  const outline = [
    { title: 'Chapter One', dest: [{ num: 0 }] },
    { title: 'Chapter Two', dest: [{ num: 2 }] },
  ];

  it('makes a reflowable book with one section per chapter and a table of contents', async () => {
    const book = await buildPdfTextBook(fakePdf(pages, outline, { Title: 'My Book' }), options);
    expect(book.isPdfText).toBe(true);
    expect(book.rendition.layout).toBe('reflowable');
    expect(book.metadata.title).toBe('My Book');
    expect(book.metadata.language).toBe('en');
    expect(book.pdfSectionStarts).toEqual([0, 2]);
    expect(book.toc?.map((t) => [t.label, t.href, t.index])).toEqual([
      ['Chapter One', 'pdf-section-0#pdf-page-0', 0],
      ['Chapter Two', 'pdf-section-1#pdf-page-2', 2],
    ]);
  });

  it('rebuilds the paragraphs across the page break, without heads or page numbers', async () => {
    const book = await buildPdfTextBook(fakePdf(pages, outline), options);
    const doc = await book.sections[0]!.createDocument();
    const paragraphs = Array.from(doc.querySelectorAll('p')).map((p) =>
      p.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(doc.querySelector('h1')?.textContent).toBe('Chapter One');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatch(
      /^The art of reading .* first time, in the quiet of the evening, .* is free\.$/,
    );
    expect(paragraphs[1]).toMatch(/^A second paragraph opens here .* ends\.$/);
    expect(doc.body.textContent).not.toContain('MY BOOK');
    // Page 2 starts inside the first paragraph: its anchor is there.
    const anchor = doc.getElementById('pdf-page-1');
    expect(anchor?.closest('p')).toBe(doc.querySelectorAll('p')[0]);
  });

  it('resolves page links, with or without the section', async () => {
    const book = await buildPdfTextBook(fakePdf(pages, outline), options);
    expect(book.resolveHref('#pdf-page-2')?.index).toBe(1);
    expect(book.resolveHref('pdf-section-0#pdf-page-1')?.index).toBe(0);
    expect(book.resolveHref('pdf-section-1')?.index).toBe(1);
    expect(book.resolveHref('chapter.xhtml')).toBeNull();
    expect(book.splitTOCHref('pdf-section-1#pdf-page-2')).toEqual(['pdf-section-1', 'pdf-page-2']);
    const doc = await book.sections[1]!.createDocument();
    expect(book.resolveHref('#pdf-page-2')!.anchor!(doc)?.id).toBe('pdf-page-2');
  });

  it('serves each section as a URL, built once', async () => {
    const book = await buildPdfTextBook(fakePdf(pages, outline), options);
    const load = (book.sections[0] as unknown as { load: () => Promise<string> }).load;
    const first = await load();
    expect(first).toMatch(/^blob:section-/);
    expect(await load()).toBe(first);
  });

  it('shows a near-empty page as a picture when it can render one', async () => {
    const withCover = [[item('A', 190, 300, 10)], ...pages];
    const book = await buildPdfTextBook(fakePdf(withCover, null), {
      ...options,
      renderPageImage: async (_page, index) => `blob:page-${index}`,
    });
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('figure img')?.getAttribute('src')).toBe('blob:page-0');
  });
});
