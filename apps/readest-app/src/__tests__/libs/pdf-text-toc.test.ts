import { beforeEach, describe, expect, it } from 'vitest';
import type { BookDoc, TOCItem } from '@/libs/document';
import {
  buildHeadingToc,
  buildPdfTextBook,
  PdfDocumentLike,
  PdfHeadingEntry,
  PdfTextItemLike,
} from '@/libs/pdfText/book';
import { loadPdfHeadings, savePdfHeadings } from '@/libs/pdfText/cache';
import { pageFromTextLocation, pdfTocItemAt } from '@/libs/pdfText/position';

/** A fake pdf.js document; coordinates follow the PDF convention (origin bottom-left). */
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
const fakePdf = (pages: PdfTextItemLike[][]): PdfDocumentLike => ({
  numPages: pages.length,
  getPage: async (n) => ({
    getViewport: () => ({ width: PAGE_W, height: PAGE_H }),
    getTextContent: async () => ({ items: pages[n - 1]! }),
  }),
  getMetadata: async () => ({ info: {}, metadata: null }),
  getOutline: async () => null,
});
const body = (text: string, y: number, x = 50) => item(text.padEnd(60, ' '), x, y);
const options = { createUrl: () => 'blob:x', revokeUrl: () => {} };

// A book without bookmarks: a title page, then two chapters, the second one
// with a section heading. Plenty of body text so the body size is clear.
const chapterPage = (title: string | null, lines: string[], section?: string) => {
  const items: PdfTextItemLike[] = [];
  let y = 80;
  if (title) {
    items.push(item(title, 120, y, 18, 160));
    y += 40;
  }
  if (section) {
    items.push(item(section, 50, y, 13, 120));
    y += 24;
  }
  for (const text of lines) {
    items.push(body(text, y, y === 120 || y === 144 ? 65 : 50));
    y += 13;
  }
  return items;
};
const prose = [
  'The quick reader turns the page and the story goes on and on',
  'through the long winter evening, while the fire burns low and',
  'the house falls silent around the chair by the window, until',
  'the last line of the chapter closes the day in a quiet way.',
];
const pages = [
  [item('THE BOOK', 140, 200, 30, 120)],
  chapterPage('Chapter One', prose),
  chapterPage(null, prose),
  chapterPage('Chapter Two', prose, 'A Small Section'),
];

describe('buildHeadingToc', () => {
  const toSection = (page: number) => Math.floor(page / 16);
  const entry = (label: string, page: number, level: 1 | 2 | 3, n = 0): PdfHeadingEntry => ({
    label,
    page,
    n,
    level,
  });

  it('lists the chapters, with the level below as sub-entries', () => {
    const toc = buildHeadingToc(
      [
        entry('My Book', 0, 1),
        entry('Chapter One', 2, 2),
        entry('A section', 3, 3),
        entry('Chapter Two', 20, 2),
      ],
      toSection,
    );
    // A lone title heading stays alongside the chapters.
    expect(toc.map((t) => t.label)).toEqual(['My Book', 'Chapter One', 'Chapter Two']);
    expect(toc[1]!.subitems?.map((t) => t.label)).toEqual(['A section']);
    expect(toc[2]!.href).toBe('pdf-section-1#pdf-h-20-0');
    expect(toc[2]!.index).toBe(20);
  });

  it('drops numbers, empty labels and repeats', () => {
    const toc = buildHeadingToc(
      [
        entry('12', 1, 2),
        entry('Part One', 2, 2),
        entry('Part One', 3, 2),
        entry('x', 4, 2),
        entry('Part Two', 5, 2),
      ],
      toSection,
    );
    expect(toc.map((t) => t.label)).toEqual(['Part One', 'Part Two']);
  });
});

describe('scanHeadings on a PDF without bookmarks', () => {
  it('finds the headings of the rebuilt text and points the table of contents at them', async () => {
    const book = await buildPdfTextBook(fakePdf(pages), options);
    expect(book.toc).toEqual([]);
    const progress: number[] = [];
    const entries = await book.scanHeadings({ onProgress: (done) => progress.push(done) });
    expect(progress[progress.length - 1]).toBe(pages.length);
    expect(entries.map((e) => [e.label, e.page, e.n, e.level])).toEqual([
      ['THE BOOK', 0, 0, 1],
      ['Chapter One', 1, 0, 1],
      ['Chapter Two', 3, 0, 1],
      // 13 pt over a 10 pt body: a third-level heading.
      ['A Small Section', 3, 1, 3],
    ]);
    // The same scan is shared by every caller.
    expect(await book.scanHeadings()).toBe(entries);

    const toc = book.headingToc(entries);
    const chapterTwo = toc.find((t) => t.label === 'Chapter Two')!;
    expect(chapterTwo.subitems?.[0]?.label).toBe('A Small Section');
    // The link lands on the heading itself in the rebuilt section.
    const resolved = book.resolveHref(chapterTwo.subitems![0]!.href)!;
    const doc = await book.sections[resolved.index]!.createDocument();
    expect(resolved.anchor!(doc)?.textContent).toBe('A Small Section');
  });

  it('keeps a page with only a title as text when it is not a picture', async () => {
    const titleOnly = [[item('Chapter Three', 120, 300, 18, 160)], ...pages.slice(1)];
    const book = await buildPdfTextBook(fakePdf(titleOnly), {
      ...options,
      // The renderer finds only words on white: no picture.
      renderPageImage: async () => null,
    });
    const doc = await book.sections[0]!.createDocument();
    expect(doc.getElementById('pdf-h-0-0')?.textContent).toBe('Chapter Three');
    expect(doc.querySelector('figure')).toBeNull();
  });
});

describe('position in text mode', () => {
  const html = `<!DOCTYPE html><html><body>
    <h1 id="pdf-h-4-0"><span class="pdf-page" id="pdf-page-4" data-page="5"></span>Chapter One</h1>
    <p id="a">First paragraph of chapter one.</p>
    <p id="b">Second <span class="pdf-page" id="pdf-page-5" data-page="6"></span>paragraph.</p>
    <h2 id="pdf-h-5-0">A Section</h2>
    <p id="c">Third paragraph.</p>
  </body></html>`;
  const book = (toc: TOCItem[]) => ({ toc, pdfSectionStarts: [0, 4] }) as unknown as BookDoc;
  const rangeAt = (doc: Document, id: string) => {
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById(id)!);
    return range;
  };
  const toc: TOCItem[] = [
    { id: 0, label: 'Front', href: 'pdf-section-0#pdf-h-1-0', index: 1 } as TOCItem,
    {
      id: 1,
      label: 'Chapter One',
      href: 'pdf-section-1#pdf-h-4-0',
      index: 4,
      subitems: [
        { id: 2, label: 'A Section', href: 'pdf-section-1#pdf-h-5-0', index: 5 } as TOCItem,
      ],
    } as TOCItem,
  ];

  it('names the chapter of the screen being read', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(pdfTocItemAt(book(toc), rangeAt(doc, 'a'), 1)?.label).toBe('Chapter One');
    expect(pdfTocItemAt(book(toc), rangeAt(doc, 'c'), 1)?.label).toBe('A Section');
    // Without a range, the section's first page decides.
    expect(pdfTocItemAt(book(toc), null, 1)?.label).toBe('Front');
  });

  it('finds the original page at the start of the screen', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(pageFromTextLocation(rangeAt(doc, 'a'), book(toc), 1)).toBe(4);
    expect(pageFromTextLocation(rangeAt(doc, 'c'), book(toc), 1)).toBe(5);
  });
});

describe('heading cache', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the headings of a book, and that a book has none', () => {
    expect(loadPdfHeadings('abc')).toBeNull();
    const entries: PdfHeadingEntry[] = [{ label: 'Chapter One', page: 2, n: 0, level: 2 }];
    savePdfHeadings('abc', entries);
    expect(loadPdfHeadings('abc')).toEqual(entries);
    savePdfHeadings('empty', []);
    expect(loadPdfHeadings('empty')).toEqual([]);
  });

  it('ignores damaged data', () => {
    localStorage.setItem('ouiread:pdf-headings:v1:bad', '{not json');
    expect(loadPdfHeadings('bad')).toBeNull();
  });
});
