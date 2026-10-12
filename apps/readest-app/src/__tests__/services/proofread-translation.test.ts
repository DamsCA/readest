import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProofreadRule } from '@/types/book';

let globalRules: ProofreadRule[] = [];
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { globalViewSettings: { proofreadRules: globalRules } } }),
  },
}));

import { applyRulesToText, getCorrectionRules } from '@/services/transformers/proofread';

let order = 0;
const rule = (pattern: string, replacement: string, extra: Partial<ProofreadRule> = {}) =>
  ({
    id: `r${order}`,
    scope: 'book',
    pattern,
    replacement,
    enabled: true,
    isRegex: false,
    order: order++,
    caseSensitive: true,
    ...extra,
  }) as ProofreadRule;

// Corrections the reader makes on translated text are plain book rules whose
// pattern is in the translation's language: they must reach the translation,
// which the HTML transformer never sees.
describe('applyRulesToText (corrections of translated text)', () => {
  beforeEach(() => {
    order = 0;
    globalRules = [];
  });

  it('replaces a French phrase everywhere in the translation', () => {
    const rules = [rule('des chats et des chiens', 'des cordes')];
    expect(
      applyRulesToText('Il pleut des chats et des chiens, encore des chats et des chiens.', rules),
    ).toBe('Il pleut des cordes, encore des cordes.');
  });

  it('matches whole words only, accents included', () => {
    const rules = [rule('été', 'fut')];
    expect(applyRulesToText("Il a été là tout l'été.", rules)).toBe("Il a fut là tout l'fut.");
    expect(applyRulesToText('Les étés passent.', rules)).toBe('Les étés passent.');
  });

  it('honours case-insensitive and regex rules', () => {
    const rules = [
      rule('monsieur', 'M.', { caseSensitive: false }),
      rule('\\bgrise?\\b', 'bleu', { isRegex: true }),
    ];
    expect(applyRulesToText('Monsieur Dupont a un chat gris et une maison grise.', rules)).toBe(
      'M. Dupont a un chat bleu et une maison bleu.',
    );
  });

  it('ignores selection-scope, TTS-only, disabled and deleted rules', () => {
    const rules = [
      rule('pleut', 'X', { scope: 'selection', cfi: 'epubcfi(/6/2!/4/1:0)' }),
      rule('pleut', 'X', { onlyForTTS: true }),
      rule('pleut', 'X', { enabled: false }),
      rule('pleut', 'X', { deletedAt: 1 }),
    ];
    expect(applyRulesToText('Il pleut.', rules)).toBe('Il pleut.');
  });

  it('applies book rules before library rules', () => {
    const rules = [
      rule('chien', 'chat', { scope: 'library' }),
      rule('loup', 'chien', { scope: 'book' }),
    ];
    // book: loup -> chien, then library: chien -> chat
    expect(applyRulesToText('Un loup.', rules)).toBe('Un chat.');
  });

  it('survives a user regex that can match nothing', () => {
    const rules = [rule('x*', 'y', { isRegex: true })];
    expect(applyRulesToText('abc', rules)).toBe('abc');
  });

  it('leaves the text alone without rules', () => {
    expect(applyRulesToText('Il pleut.', [])).toBe('Il pleut.');
    expect(applyRulesToText('Il pleut.', undefined)).toBe('Il pleut.');
  });

  it('merges library-wide rules with the book ones', () => {
    globalRules = [rule('a', 'b', { scope: 'library' })];
    const book = [rule('c', 'd')];
    expect(getCorrectionRules(book).map((r) => r.pattern)).toEqual(['a', 'c']);
    expect(getCorrectionRules(undefined).map((r) => r.pattern)).toEqual(['a']);
  });
});
