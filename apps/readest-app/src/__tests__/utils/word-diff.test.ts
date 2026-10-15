import { describe, it, expect } from 'vitest';
import { contextAround, correctionKind, wordDiff } from '@/utils/wordDiff';

describe('wordDiff', () => {
  it('marks the replaced word', () => {
    expect(wordDiff('a cold rnorning in', 'a cold morning in')).toEqual([
      { kind: 'same', text: 'a cold' },
      { kind: 'del', text: 'rnorning' },
      { kind: 'add', text: 'morning' },
      { kind: 'same', text: 'in' },
    ]);
  });

  it('marks an added word', () => {
    expect(wordDiff('the peg by', 'the peg on by')).toEqual([
      { kind: 'same', text: 'the peg' },
      { kind: 'add', text: 'on' },
      { kind: 'same', text: 'by' },
    ]);
  });

  it('marks a removed word', () => {
    expect(wordDiff('of of paper', 'of paper')).toEqual([
      { kind: 'same', text: 'of' },
      { kind: 'del', text: 'of' },
      { kind: 'same', text: 'paper' },
    ]);
  });
});

describe('correctionKind', () => {
  it('names a missing word, an extra word and a spelling fix', () => {
    expect(correctionKind('the peg by', 'the peg on by')).toBe('added');
    expect(correctionKind('of of paper', 'of paper')).toBe('removed');
    expect(correctionKind('cold rnorning in', 'cold morning in')).toBe('spelling');
  });

  it('names spacing and punctuation fixes', () => {
    expect(correctionKind('some- thing', 'something')).toBe('spacing');
    expect(correctionKind('that.What he', 'that. What he')).toBe('spacing');
  });

  it('calls anything wider a rewording', () => {
    expect(correctionKind('who are working', 'who were working hard')).toBe('changed');
  });
});

describe('contextAround', () => {
  const text = 'It was a cold rnorning in March. He hung his coat on the peg.';

  it('gives the words on each side', () => {
    expect(contextAround(text, 'cold rnorning', 2)).toEqual({
      before: 'was a',
      after: 'in March.',
    });
  });

  it('stops at the edges of the paragraph', () => {
    expect(contextAround(text, 'It was', 5)).toEqual({
      before: '',
      after: 'a cold rnorning in March.',
    });
  });

  it('gives nothing when the excerpt is not in the paragraph', () => {
    expect(contextAround(text, 'not there')).toEqual({ before: '', after: '' });
  });
});
