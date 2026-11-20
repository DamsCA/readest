import { decodeHtmlEntities } from '@/utils/htmlEntities';

export type Polisher = (text: string) => string;

const languagePolishers: Record<string, Polisher> = {
  // Chinese - fix punctuation spacing
  zh: (text: string) =>
    text
      .replace(/--/g, '⸺')
      .replace(/\s+([。、！？])/g, '$1')
      .replace(/([。、！？])\s+/g, '$1'),

  // Spanish - fix punctuation spacing
  es: (text: string) =>
    text.replace(/\?([A-ZÁÉÍÓÚÑÜ])/g, '? $1').replace(/\!([A-ZÁÉÍÓÚÑÜ])/g, '! $1'),

  // French - a space before ; : ! ? (French typography). basicPolish has just
  // removed it, which is right for English, and this polisher used to look for
  // a space that was no longer there: "Pourquoi ?" came out "Pourquoi?" in
  // every French translation, and in the rewrite of "Comment se faire des
  // amis" (20 Nov 2026). It comes back as a no-break space, so the mark never
  // starts a line on its own. Only after a word and before a space or the end:
  // times, verses and links (10:30, 3:16, http://) stay as they are.
  fr: (text: string) =>
    text
      .replace(/([^\s!?:;«([{])([!?:;]+)(?=\s|$|[»)\]}"”’.…,])/g, '$1 $2')
      .replace(/([!?:;])\s+/g, '$1 '),

  // Japanese - fix punctuation spacing
  ja: (text: string) => text.replace(/\s+([。、！？])/g, '$1').replace(/([。、！？])\s+/g, '$1'),
};

export const basicPolish: Polisher = (text: string) => {
  // A translator's "l&#39;homme" would show as is: the text is never parsed as HTML.
  return decodeHtmlEntities(text)
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .replace(/\s+([.,!?;:])/g, '$1') // Remove space before punctuation
    .trim();
};

export function getPolisher(targetLang: string): Polisher {
  const langCode = targetLang.split('-')[0]!.toLowerCase();
  const languagePolisher = languagePolishers[langCode];

  if (languagePolisher) {
    return (text: string) => {
      const basicPolished = basicPolish(text);
      const polished = languagePolisher(basicPolished);
      return polished;
    };
  }

  return basicPolish;
}

export function polish(texts: string[], targetLang: string): string[] {
  const polisher = getPolisher(targetLang);
  return texts.map(polisher);
}
