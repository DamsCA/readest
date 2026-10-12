import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyCorrectionsToDocs,
  collectPageParagraphs,
  hashParagraph,
  locateInNodes,
  paragraphText,
  sourceTextNodes,
} from '@/utils/aiProofreadDom';

const page = () => {
  document.body.innerHTML = `
    <h1>The Call</h1>
    <p id="a">Tom picked up the
      the phone, but his hands were shaking.<font class="translation-target"><font class="translation-target-block">Tom a décroché le le téléphone.</font></font></p>
    <p id="b">The <em>rnorning</em> was cold and the vvind blew.</p>
    <p id="c">She had never seen such a sight in al1 her life.</p>`;
  const range = document.createRange();
  range.setStart(document.getElementById('a')!.firstChild!, 0);
  range.setEnd(document.getElementById('b')!.lastChild!, 5);
  return range;
};

describe('collectPageParagraphs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the visible paragraphs with their own text only, whitespace collapsed', () => {
    const paragraphs = collectPageParagraphs(page());

    expect(paragraphs.map((p) => p.el.id)).toEqual(['a', 'b']);
    // The injected translation is not part of the book's text.
    expect(paragraphs[0]!.text).toBe('Tom picked up the the phone, but his hands were shaking.');
    expect(paragraphs[1]!.text).toBe('The rnorning was cold and the vvind blew.');
  });

  it('skips headings and other texts under 3 words', () => {
    const range = page();
    range.setStartBefore(document.querySelector('h1')!);
    expect(collectPageParagraphs(range).map((p) => p.el.tagName)).toEqual(['P', 'P']);
  });
});

describe('locateInNodes', () => {
  beforeEach(() => {
    page();
  });

  it('finds the book text behind collapsed whitespace and keeps its line break', () => {
    const nodes = sourceTextNodes(document.getElementById('a')!);
    const raw = locateInNodes(nodes, 'the the phone');
    expect(raw).toMatch(/^the\s+the phone$/);
    expect(raw).toContain('\n');
  });

  it('refuses an excerpt that spans formatting (two text nodes)', () => {
    const nodes = sourceTextNodes(document.getElementById('b')!);
    expect(locateInNodes(nodes, 'The rnorning')).toBeNull();
    expect(locateInNodes(nodes, 'rnorning')).toBe('rnorning');
  });

  it('refuses a match inside a longer word, as the saved rule would never apply there', () => {
    document.body.innerHTML = '<p id="x">They bathe the dog every week, she said.</p>';
    const nodes = sourceTextNodes(document.getElementById('x')!);
    expect(locateInNodes(nodes, 'the the')).toBeNull();
  });

  it('refuses punctuation-only excerpts, too vague to place', () => {
    const nodes = sourceTextNodes(document.getElementById('a')!);
    expect(locateInNodes(nodes, ' , ')).toBeNull();
  });
});

describe('applyCorrectionsToDocs', () => {
  it('corrects the book text everywhere in the section, never the translation', () => {
    page();
    applyCorrectionsToDocs(
      [document],
      [
        { find: 'vvind', replace: 'wind' },
        { find: 'al1', replace: 'all' },
      ],
    );
    expect(paragraphText(document.getElementById('b')!)).toBe(
      'The rnorning was cold and the wind blew.',
    );
    expect(paragraphText(document.getElementById('c')!)).toBe(
      'She had never seen such a sight in all her life.',
    );
    expect(document.querySelector('.translation-target')!.textContent).toBe(
      'Tom a décroché le le téléphone.',
    );
  });
});

describe('hashParagraph', () => {
  it('is stable and tells texts apart', () => {
    expect(hashParagraph('Tom picked up the phone.')).toBe(
      hashParagraph('Tom picked up the phone.'),
    );
    expect(hashParagraph('Tom picked up the phone.')).not.toBe(
      hashParagraph('Tom picked up the the phone.'),
    );
  });
});
