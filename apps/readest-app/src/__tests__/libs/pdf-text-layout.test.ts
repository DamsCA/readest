import { describe, expect, it } from 'vitest';
import {
  blocksToHtml,
  blockText,
  computeStats,
  continuesAcrossPages,
  findRunningLines,
  isPageNumber,
  joinLineText,
  marginKey,
  mergeBlocks,
  pageToBlocks,
  PdfBlock,
  PdfLine,
  PdfPageText,
  PdfTextRun,
  runsToLines,
} from '@/libs/pdfText/layout';
import { detectLanguage } from '@/libs/pdfText/language';

const PAGE_W = 400;
const PAGE_H = 600;
const LEFT = 50;
const RIGHT = 350;
const BODY = 10;
const LEADING = 13;

/** A justified body line: full width unless `short`. */
const line = (
  text: string,
  y: number,
  opts: Partial<PdfLine> & { short?: boolean } = {},
): PdfLine => ({
  text,
  x: opts.x ?? LEFT,
  xEnd: opts.xEnd ?? (opts.short ? LEFT + 120 : RIGHT),
  y,
  fontSize: opts.fontSize ?? BODY,
  bold: opts.bold ?? false,
  italic: false,
});

const page = (index: number, lines: PdfLine[]): PdfPageText => ({
  index,
  width: PAGE_W,
  height: PAGE_H,
  lines,
});

const noMargins = () => false;
const stats = { bodySize: BODY };
const texts = (blocks: PdfBlock[]) => blocks.map(blockText);

describe('runsToLines', () => {
  it('joins the runs of one baseline and adds the missing spaces', () => {
    const runs: PdfTextRun[] = [
      { str: 'Hello', x: 50, y: 100, width: 25, fontSize: 10 },
      { str: 'world', x: 79, y: 100.5, width: 25, fontSize: 10, hasEOL: true },
      { str: 'Next line', x: 50, y: 113, width: 45, fontSize: 10 },
    ];
    const lines = runsToLines(runs);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next line']);
    expect(lines[0]!.xEnd).toBe(104);
  });

  it('does not add a space inside a word split in two runs', () => {
    const runs: PdfTextRun[] = [
      { str: 'exam', x: 50, y: 100, width: 20, fontSize: 10 },
      { str: 'ple', x: 70.5, y: 100, width: 15, fontSize: 10 },
    ];
    expect(runsToLines(runs)[0]!.text).toBe('example');
  });

  it('starts a new line on a new baseline even without an end-of-line mark', () => {
    const runs: PdfTextRun[] = [
      { str: 'one', x: 50, y: 100, width: 15, fontSize: 10 },
      { str: 'two', x: 50, y: 113, width: 15, fontSize: 10 },
    ];
    expect(runsToLines(runs).map((l) => l.text)).toEqual(['one', 'two']);
  });

  it('reads letter-spaced titles as words', () => {
    // "THE ART" with 2 units of tracking between letters and a wider word space.
    const glyphs = 'THEART'.split('');
    let x = 50;
    const runs: PdfTextRun[] = glyphs.map((ch, i) => {
      const run = { str: ch, x, y: 60, width: 6, fontSize: 10 };
      x += 6 + (i === 2 ? 7 : 2);
      return run;
    });
    expect(runsToLines(runs)[0]!.text).toBe('THE ART');
  });

  it('takes the size of most characters, not of a lone drop cap', () => {
    const runs: PdfTextRun[] = [
      { str: 'W', x: 50, y: 100, width: 10, fontSize: 30 },
      { str: 'hen the night fell over the town', x: 62, y: 100, width: 200, fontSize: 10 },
    ];
    expect(runsToLines(runs)[0]!.fontSize).toBe(10);
  });
});

describe('joinLineText', () => {
  it('removes the hyphen of a word split at the end of a line', () => {
    expect(joinLineText('a beautiful exam-', 'ple of it')).toBe('a beautiful example of it');
    expect(joinLineText('connais-', 'sance')).toBe('connaissance');
  });

  it('keeps the hyphen when the next line starts with a capital', () => {
    expect(joinLineText('Jean-', 'Pierre')).toBe('Jean- Pierre');
  });

  it('removes soft hyphens and joins dashes without a space', () => {
    expect(joinLineText('trans­', 'lation')).toBe('translation');
    expect(joinLineText('and then—', 'silence')).toBe('and then—silence');
  });

  it('joins ordinary lines with one space', () => {
    expect(joinLineText('The end of a line', 'and the next')).toBe(
      'The end of a line and the next',
    );
  });
});

describe('isPageNumber / marginKey', () => {
  it('recognises page numbers in their usual forms', () => {
    for (const t of [
      '12',
      '- 12 -',
      '— 7 —',
      'Page 3',
      'p. 45',
      '12 / 240',
      '3 of 10',
      'xiv',
      '[9]',
    ]) {
      expect(isPageNumber(t), t).toBe(true);
    }
  });

  it('does not take words or sentences for page numbers', () => {
    for (const t of ['Chapter 12', 'The end.', 'In 1990 we left', 'Introduction']) {
      expect(isPageNumber(t), t).toBe(false);
    }
  });

  it('ignores digits in running heads', () => {
    expect(marginKey('The Art of War  12')).toBe(marginKey('the art of war 13'));
  });
});

describe('findRunningLines', () => {
  it('finds the running head repeated at the top of the pages', () => {
    const pages = Array.from({ length: 8 }, (_, i) =>
      page(i, [
        line(`THE GREAT BOOK ${i + 1}`, 30, { short: true }),
        line('Body text that changes on every page number ' + i, 100),
        line(String(i + 1), 580, { short: true }),
      ]),
    );
    const keys = findRunningLines(pages);
    expect(keys.has(marginKey('THE GREAT BOOK 1'))).toBe(true);
    expect([...keys].some((k) => k.startsWith('body text'))).toBe(false);
  });
});

describe('pageToBlocks', () => {
  it('splits paragraphs on first-line indents and joins the other lines', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('It was a bright cold day in April, and the clocks were', 100, { x: LEFT + 15 }),
        line('striking thirteen. Winston Smith slipped quickly through', 113),
        line('the glass doors.', 126, { short: true }),
        line('The hallway smelt of boiled cabbage and old rag mats.', 139, { x: LEFT + 15 }),
        line('At one end of it a coloured poster was tacked to the wall.', 152, { short: true }),
      ]),
      stats,
      noMargins,
    );
    expect(texts(blocks)).toEqual([
      'It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith slipped quickly through the glass doors.',
      'The hallway smelt of boiled cabbage and old rag mats. At one end of it a coloured poster was tacked to the wall.',
    ]);
  });

  it('splits paragraphs on extra vertical space when there is no indent', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('First paragraph line one goes on and on across the page', 100),
        line('and ends here.', 100 + LEADING, { short: true }),
        line('Second paragraph starts after a blank line and continues', 100 + LEADING * 3),
        line('until the end.', 100 + LEADING * 4, { short: true }),
      ]),
      stats,
      noMargins,
    );
    expect(blocks).toHaveLength(2);
    expect(blockText(blocks[1]!)).toMatch(/^Second paragraph/);
  });

  it('turns bigger lines into headings, by size', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('CHAPTER ONE', 60, { fontSize: 20, x: 150, xEnd: 250 }),
        line('The Beginning', 90, { fontSize: 14, x: 160, xEnd: 240 }),
        line('Once upon a time there was a reader who loved long books', 130),
        line('and short nights.', 143, { short: true }),
      ]),
      stats,
      noMargins,
    );
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 2 });
    expect(blocks[2]).toMatchObject({ kind: 'paragraph' });
  });

  it('merges a heading written on two lines', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('How to Read a Book', 60, { fontSize: 20, x: 120, xEnd: 280 }),
        line('in One Evening', 84, { fontSize: 20, x: 140, xEnd: 260 }),
      ]),
      stats,
      noMargins,
    );
    expect(blocks).toHaveLength(1);
    expect(blockText(blocks[0]!)).toBe('How to Read a Book in One Evening');
  });

  it('keeps one-line lines of dialogue apart, even when every line is indented', () => {
    // A page of dialogue: each reply is a one-line paragraph with an indent,
    // so no line starts at the margin. The usual margin of the book decides.
    const dialogue = page(3, [
      line("'What do you mean by that?' said the Caterpillar sternly.", 100, { x: LEFT + 15 }),
      // The second line of the first reply starts at the margin.
      line("'Explain yourself!'", 113, { short: true }),
      line("'I can't explain MYSELF, I'm afraid, sir,' said Alice.", 126, { x: LEFT + 15 }),
      line("'I don't see,' said the Caterpillar.", 139, { x: LEFT + 15, short: true }),
    ]);
    const blocks = pageToBlocks(
      dialogue,
      { bodySize: BODY, left: LEFT, right: RIGHT, leftByParity: [LEFT, LEFT] },
      noMargins,
    );
    expect(texts(blocks)).toEqual([
      "'What do you mean by that?' said the Caterpillar sternly. 'Explain yourself!'",
      "'I can't explain MYSELF, I'm afraid, sir,' said Alice.",
      "'I don't see,' said the Caterpillar.",
    ]);
  });

  it('keeps each list item apart', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('• Write it down by hand', 100, { short: true }),
        line('• Read it every morning', 113, { short: true }),
        line('• Feel it as if it were done', 126, { short: true }),
      ]),
      stats,
      noMargins,
    );
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.kind === 'paragraph' && b.list)).toBe(true);
  });

  it('attaches a drop cap to the word that follows', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('T', 100, { fontSize: 32, xEnd: LEFT + 20 }),
        line('he story begins on a quiet morning in a small town by the', 100, { x: LEFT + 25 }),
        line('sea.', 113, { short: true }),
      ]),
      stats,
      noMargins,
    );
    expect(blocks).toHaveLength(1);
    expect(blockText(blocks[0]!)).toBe(
      'The story begins on a quiet morning in a small town by the sea.',
    );
  });

  it('drops the lines the margin predicate rejects', () => {
    const blocks = pageToBlocks(
      page(0, [
        line('RUNNING HEAD', 30, { short: true }),
        line('Real text of the page that must stay where it is now.', 100, { short: true }),
        line('42', 580, { short: true }),
      ]),
      stats,
      (l) => l.y < 60 || l.y > 540,
    );
    expect(texts(blocks)).toEqual(['Real text of the page that must stay where it is now.']);
  });
});

describe('across pages', () => {
  const unfinished: PdfBlock = {
    kind: 'paragraph',
    segments: [{ text: 'and so the story went on and on without an end in exam-', page: 4 }],
  };

  it('continues a paragraph cut by the page break', () => {
    const next: PdfBlock = {
      kind: 'paragraph',
      segments: [{ text: 'ple, until the very last page.', page: 5 }],
    };
    expect(continuesAcrossPages(unfinished, next)).toBe(true);
    const merged: PdfBlock = {
      ...unfinished,
      segments: unfinished.segments.map((s) => ({ ...s })),
    };
    mergeBlocks(merged, next);
    expect(blockText(merged)).toBe(
      'and so the story went on and on without an end in example, until the very last page.',
    );
    // The new page keeps its own segment, so its anchor lands at the right word.
    expect(merged.kind === 'paragraph' && merged.segments.map((s) => s.page)).toEqual([4, 5]);
  });

  it('does not join when the new page opens a new paragraph', () => {
    const ended: PdfBlock = {
      kind: 'paragraph',
      segments: [{ text: 'The end of the chapter.', page: 4 }],
    };
    const indented: PdfBlock = {
      kind: 'paragraph',
      indented: true,
      segments: [{ text: 'and a lowercase start', page: 5 }],
    };
    const capital: PdfBlock = {
      kind: 'paragraph',
      segments: [{ text: 'A new thought.', page: 5 }],
    };
    const heading: PdfBlock = {
      kind: 'heading',
      level: 1,
      segments: [{ text: 'Part Two', page: 5 }],
    };
    expect(continuesAcrossPages(ended, capital)).toBe(false);
    expect(continuesAcrossPages(unfinished, indented)).toBe(false);
    expect(continuesAcrossPages(unfinished, heading)).toBe(false);
  });

  it('joins a sentence ended at the foot of the page only if the next starts lowercase', () => {
    const ended: PdfBlock = {
      kind: 'paragraph',
      segments: [{ text: 'He said: "Maybe."', page: 2 }],
    };
    const lower: PdfBlock = { kind: 'paragraph', segments: [{ text: 'then left.', page: 3 }] };
    expect(continuesAcrossPages(ended, lower)).toBe(true);
  });
});

describe('blocksToHtml', () => {
  it('writes clean HTML with page anchors and escaped text', () => {
    const html = blocksToHtml(
      [
        { kind: 'heading', level: 1, segments: [{ text: 'Rock & Roll <live>', page: 0 }] },
        {
          kind: 'paragraph',
          segments: [
            { text: 'Before the break ', page: 0 },
            { text: 'after the break.', page: 1 },
          ],
        },
      ],
      { lang: 'en', title: 'Test', pages: [0, 1, 2] },
    );
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      // The heading carries its own id, for the table of contents.
      '<h1 id="pdf-h-0-0"><span class="pdf-page" id="pdf-page-0" data-page="1"></span>Rock &amp; Roll &lt;live&gt;</h1>',
    );
    expect(html).toContain(
      '<p>Before the break <span class="pdf-page" id="pdf-page-1" data-page="2"></span>after the break.</p>',
    );
    // A page without text still gets its anchor.
    expect(html).toContain('id="pdf-page-2"');
  });

  it('parses into a document with one anchor per page', () => {
    const html = blocksToHtml([{ kind: 'image', page: 0, src: 'blob:cover' }], { pages: [0] });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('.pdf-page')).toHaveLength(1);
    expect(doc.querySelector('figure img')?.getAttribute('src')).toBe('blob:cover');
  });
});

describe('computeStats / detectLanguage', () => {
  it('takes the most used size as the body size', () => {
    const s = computeStats([
      page(0, [
        line('Big title', 50, { fontSize: 24 }),
        line('A long line of normal body text, the kind that fills a book', 100),
        line('another long line of normal body text, and many more like it', 113),
      ]),
    ]);
    expect(s.bodySize).toBe(10);
  });

  it('recognises English and French', () => {
    expect(
      detectLanguage(
        'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, and we had everything before us, and we were all going to the end of the road with you.',
      ),
    ).toBe('en');
    expect(
      detectLanguage(
        'Il était une fois, dans un pays lointain, une jeune fille qui aimait les livres. Elle lisait tous les soirs avec sa mère, et elle ne savait pas que cette histoire allait changer sa vie pour toujours, et la nôtre aussi.',
      ),
    ).toBe('fr');
  });

  it('says nothing about a tiny sample', () => {
    expect(detectLanguage('Hello world')).toBe('');
  });
});
