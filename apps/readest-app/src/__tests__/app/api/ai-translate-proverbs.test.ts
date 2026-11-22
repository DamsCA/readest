import { describe, expect, it } from 'vitest';
import { findSayings, sayingsInstruction } from '@/app/api/ai/translate/proverbs';

describe('English sayings for the AI translation', () => {
  it('finds the saying of It Works even with its drop cap lost', () => {
    const text =
      'F wishes were horses, beggars would ride," is the attitude taken by the average man and woman.';
    expect(findSayings(text).map(([, french]) => french)).toEqual([
      'Avec des si, on mettrait Paris en bouteille',
    ]);
  });

  it('reads curly quotes and capitals', () => {
    expect(findSayings('Where there’s smoke, as they say…')).toHaveLength(1);
    expect(findSayings('The Early Bird catches the worm.')).toHaveLength(1);
  });

  it('adds nothing to a passage without a known saying', () => {
    expect(sayingsInstruction('She cut a piece of cake for each child.', 'French')).toBe('');
  });

  it('only speaks French', () => {
    expect(sayingsInstruction('If wishes were horses, beggars would ride.', 'Spanish')).toBe('');
    expect(sayingsInstruction('If wishes were horses, beggars would ride.', 'French')).toContain(
      'Paris en bouteille',
    );
  });
});
