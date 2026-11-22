import { describe, expect, it } from 'vitest';
import { preparePassage } from '@/app/api/ai/translate/proverbs';

describe('English sayings for the AI translation', () => {
  it('puts the saying of It Works in French before translation, drop cap lost or not', () => {
    for (const text of [
      'F wishes were horses, beggars would ride," is the attitude taken by the average man.',
      '"If wishes were horses, beggars would ride," is the attitude taken by the average man.',
    ]) {
      const prepared = preparePassage(text, 'French');
      expect(prepared.text).toContain('Avec des si, on mettrait Paris en bouteille');
      expect(prepared.text).not.toMatch(/horses|beggars/);
      expect(prepared.instruction).toContain('word for word');
    }
  });

  it('reads curly apostrophes and capitals', () => {
    const prepared = preparePassage('Rome wasn’t built in a day, she said.', 'French');
    expect(prepared.replaced).toEqual(["Paris ne s'est pas fait en un jour"]);
  });

  it('points out an idiom that bends with its sentence', () => {
    const prepared = preparePassage('She killed two birds with one stone.', 'French');
    expect(prepared.text).toBe('She killed two birds with one stone.');
    expect(prepared.idioms.map(([, french]) => french)).toEqual(["faire d'une pierre deux coups"]);
  });

  it('leaves a passage without a known saying alone', () => {
    const text = 'She cut a piece of cake for each child.';
    expect(preparePassage(text, 'French')).toEqual({
      text,
      instruction: '',
      replaced: [],
      idioms: [],
    });
  });

  it('only speaks French', () => {
    const text = 'If wishes were horses, beggars would ride.';
    expect(preparePassage(text, 'Spanish').text).toBe(text);
  });
});
