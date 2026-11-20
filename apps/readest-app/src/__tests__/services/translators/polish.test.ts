import { describe, it, expect } from 'vitest';
import { basicPolish, getPolisher, polish } from '@/services/translators/polish';

describe('basicPolish', () => {
  it('collapses multiple spaces into a single space', () => {
    expect(basicPolish('hello   world')).toBe('hello world');
  });

  it('removes space before punctuation', () => {
    expect(basicPolish('hello , world')).toBe('hello, world');
    expect(basicPolish('hello . world')).toBe('hello. world');
    expect(basicPolish('what ?')).toBe('what?');
    expect(basicPolish('wow !')).toBe('wow!');
    expect(basicPolish('item ; next')).toBe('item; next');
    expect(basicPolish('time : value')).toBe('time: value');
  });

  it('trims whitespace', () => {
    expect(basicPolish('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(basicPolish('')).toBe('');
  });

  it('handles string with only spaces', () => {
    expect(basicPolish('     ')).toBe('');
  });

  it('handles tabs and newlines as whitespace', () => {
    expect(basicPolish('hello\t\n  world')).toBe('hello world');
  });
});

describe('getPolisher', () => {
  describe('Chinese (zh)', () => {
    const polisher = getPolisher('zh');

    it('replaces -- with ⸺', () => {
      expect(polisher('hello--world')).toBe('hello⸺world');
    });

    it('removes space before Chinese punctuation', () => {
      expect(polisher('你好 。再见')).toBe('你好。再见');
      expect(polisher('你好 、再见')).toBe('你好、再见');
      expect(polisher('你好 ！再见')).toBe('你好！再见');
      expect(polisher('你好 ？再见')).toBe('你好？再见');
    });

    it('removes space after Chinese punctuation', () => {
      expect(polisher('你好。 再见')).toBe('你好。再见');
    });

    it('also applies basic polishing first', () => {
      expect(polisher('  hello   world  ')).toBe('hello world');
    });
  });

  describe('Japanese (ja)', () => {
    const polisher = getPolisher('ja');

    it('removes space before Japanese punctuation', () => {
      expect(polisher('こんにちは 。さようなら')).toBe('こんにちは。さようなら');
      expect(polisher('こんにちは 、さようなら')).toBe('こんにちは、さようなら');
    });

    it('removes space after Japanese punctuation', () => {
      expect(polisher('こんにちは。 さようなら')).toBe('こんにちは。さようなら');
    });
  });

  describe('Spanish (es)', () => {
    const polisher = getPolisher('es');

    it('adds space between ? and uppercase letters', () => {
      expect(polisher('?Hola')).toBe('? Hola');
    });

    it('adds space between ! and uppercase letters', () => {
      expect(polisher('!Amigos')).toBe('! Amigos');
    });

    it('handles accented uppercase characters', () => {
      expect(polisher('?Ángel')).toBe('? Ángel');
      expect(polisher('!Último')).toBe('! Último');
    });
  });

  describe('French (fr)', () => {
    const polisher = getPolisher('fr');

    const NBSP = ' ';

    // basicPolish removes the space before punctuation (English); French wants
    // it back. "Pourquoi ?" came out "Pourquoi?" (20 Nov 2026).
    it('keeps the space before ; : ! ? that French typography wants', () => {
      expect(polisher('Pourquoi ? Parce que.')).toBe(`Pourquoi${NBSP}? Parce que.`);
      expect(polisher('précieuse : cette')).toBe(`précieuse${NBSP}: cette`);
      expect(polisher('Eh bien ; voilà !')).toBe(`Eh bien${NBSP}; voilà${NBSP}!`);
    });

    it('puts the space back when the translator left it out', () => {
      expect(polisher('Pourquoi? Parce que.')).toBe(`Pourquoi${NBSP}? Parce que.`);
      expect(polisher('Bonjour  !')).toBe(`Bonjour${NBSP}!`);
    });

    it('a no-break space, whatever space came in', () => {
      expect(polisher('Bonjour !')).toBe(`Bonjour${NBSP}!`);
      expect(polisher(`Bonjour${NBSP}!`)).toBe(`Bonjour${NBSP}!`);
    });

    it('one space before a run of marks, and inside quotes', () => {
      expect(polisher('Quoi ?!')).toBe(`Quoi${NBSP}?!`);
      expect(polisher('celui-ci!...')).toBe(`celui-ci${NBSP}!...`);
      expect(polisher('« Viens ! » dit-il : « Vite ! »')).toBe(
        `« Viens${NBSP}! » dit-il${NBSP}: « Vite${NBSP}! »`,
      );
    });

    it('leaves times, verses and links alone', () => {
      expect(polisher('à 10:30 précises')).toBe('à 10:30 précises');
      expect(polisher('Jean 3:16 le dit')).toBe('Jean 3:16 le dit');
      expect(polisher('voir https://exemple.fr ici')).toBe('voir https://exemple.fr ici');
    });

    it('gives the same text when polished twice', () => {
      const once = polisher('Pourquoi ? Eh bien : « Non ! »');
      expect(polisher(once)).toBe(once);
    });

    it('normalizes space after high punctuation', () => {
      expect(polisher('!  Bonjour')).toBe('! Bonjour');
    });

    it('handles text without high punctuation', () => {
      expect(polisher('Bonjour le monde')).toBe('Bonjour le monde');
    });
  });

  describe('unsupported language', () => {
    it('falls back to basicPolish for unknown language', () => {
      const polisher = getPolisher('de');
      expect(polisher('hello   world  , test')).toBe('hello world, test');
    });
  });

  describe('language code with region', () => {
    it('uses the base language code from zh-CN', () => {
      const polisher = getPolisher('zh-CN');
      // Should use Chinese polisher
      expect(polisher('hello--world')).toBe('hello⸺world');
    });

    it('uses the base language code from ja-JP', () => {
      const polisher = getPolisher('ja-JP');
      expect(polisher('こんにちは 。さようなら')).toBe('こんにちは。さようなら');
    });
  });
});

describe('polish', () => {
  it('polishes an array of texts', () => {
    const result = polish(['hello   world', '  test  '], 'en');
    expect(result).toEqual(['hello world', 'test']);
  });

  it('polishes with language-specific rules', () => {
    const result = polish(['hello--world', '你好 。再见'], 'zh');
    expect(result).toEqual(['hello⸺world', '你好。再见']);
  });

  it('returns empty array for empty input', () => {
    expect(polish([], 'en')).toEqual([]);
  });
});
