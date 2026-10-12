import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '@/utils/htmlEntities';
import { polish } from '@/services/translators/polish';

describe('decodeHtmlEntities', () => {
  it('turns the codes a translator left back into characters', () => {
    expect(decodeHtmlEntities('l&#39;homme qu&#39;il a vu')).toBe("l'homme qu'il a vu");
    expect(decodeHtmlEntities('&quot;Bien&quot; &amp; s&#x27;il')).toBe('"Bien" & s\'il');
    expect(decodeHtmlEntities('&laquo; Oui &raquo;, l&rsquo;homme&hellip;')).toBe(
      '« Oui », l’homme…',
    );
  });

  it('decodes text escaped twice, and any other named entity', () => {
    expect(decodeHtmlEntities('l&amp;#39;homme')).toBe("l'homme");
    expect(decodeHtmlEntities('caf&eacute;')).toBe('café');
  });

  it('leaves plain text and unknown codes alone', () => {
    expect(decodeHtmlEntities('AT&T et Tom & Jerry')).toBe('AT&T et Tom & Jerry');
    expect(decodeHtmlEntities('&bogus; &#99999999;')).toBe('&bogus; &#99999999;');
  });
});

describe('polish', () => {
  // Every translation shown or read goes through polish, cached ones included.
  it('cleans the codes out of a French translation', () => {
    expect(polish(['C&#39;est l&#39;heure, &quot;dit-il&quot;.'], 'fr')).toEqual([
      'C\'est l\'heure, "dit-il".',
    ]);
  });
});
