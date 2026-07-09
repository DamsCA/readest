import { TTSMark } from '@/services/tts/types';
import { code6392to6391, inferLangFromScript, isSameLang, isValidLang } from './lang';

const cleanTextContent = (text: string) =>
  text.replace(/\r\n/g, '  ').replace(/\r/g, ' ').replace(/\n/g, ' ').trimStart();

export const genSSML = (lang: string, text: string, voice: string, rate: number) => {
  const cleanedText = text.replace(/^<break\b[^>]*>/i, '');
  return `
    <speak version="1.0" xml:lang="${lang}">
      <voice name="${voice}">
        <prosody rate="${rate}" >
            ${cleanedText}
        </prosody>
      </voice>
    </speak>
  `;
};

export const genSSMLRaw = (text: string) => {
  return `
    <speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en"><mark name="-1"/>${text}</speak>
  `;
};

export const parseSSMLLang = (ssml: string, primaryLang?: string): string => {
  let lang = 'en';
  const match = ssml.match(/xml:lang\s*=\s*"([^"]+)"/);
  if (match && match[1]) {
    // Normalize each subtag by its role instead of blindly uppercasing the
    // second one: 2-letter = region (UPPER), 4-letter = script (Title), so
    // `zh-Hant-TW` stays `zh-Hant-TW` instead of collapsing to an invalid
    // `zh-HANT` that falls back to English.
    const [primary, ...rest] = match[1].split('-');
    lang = primary!.toLowerCase();
    for (const sub of rest) {
      if (sub.length === 2) lang += `-${sub.toUpperCase()}`;
      else if (sub.length === 4) lang += `-${sub[0]!.toUpperCase()}${sub.slice(1).toLowerCase()}`;
      else lang += `-${sub}`;
    }

    lang = code6392to6391(lang) || lang;
    if (!isValidLang(lang)) {
      lang = 'en';
    }
  }
  primaryLang = code6392to6391(primaryLang?.toLowerCase() || '') || primaryLang;
  if (lang === 'en' && primaryLang && !isSameLang(lang, primaryLang)) {
    lang = primaryLang.split('-')[0]!.toLowerCase();
  }
  const textWithoutLangTags = ssml.replace(/<lang[^>]*>.*?<\/lang>/gs, '');
  return inferLangFromScript(textWithoutLangTags, lang);
};

const isValidMark = (mark: string) => {
  const trimmed = mark.trim();
  if (!trimmed || trimmed.length === 0) {
    return false;
  }
  if (/^[\p{P}\p{S}]+$/u.test(trimmed)) {
    return false;
  }
  return true;
};

export const parseSSMLMarks = (ssml: string, primaryLang?: string) => {
  const defaultLang = parseSSMLLang(ssml, primaryLang) || 'en';
  ssml = ssml.replace(/<speak[^>]*>/i, '').replace(/<\/speak>/i, '');

  let plainText = '';
  const marks: TTSMark[] = [];

  let activeMark: string | null = null;
  let currentLang = defaultLang;
  const langStack: string[] = [];

  const tagRegex = /<(\/?)(\w+)([^>]*)>|([^<]+)/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(ssml)) !== null) {
    if (match[4]) {
      const rawText = match[4];
      const text = cleanTextContent(rawText);
      if (text && activeMark && isValidMark(text)) {
        const offset = plainText.length;
        plainText += text;
        marks.push({
          offset,
          name: activeMark,
          text,
          language: inferLangFromScript(text, currentLang) || currentLang,
        });
      } else {
        plainText += cleanTextContent(rawText);
      }
    } else {
      const isEnd = match[1] === '/';
      const tagName = match[2];
      const attr = match[3];

      if (tagName === 'mark' && !isEnd) {
        const nameMatch = attr?.match(/name="([^"]+)"/);
        if (nameMatch) {
          activeMark = nameMatch[1]!;
        }
      } else if (tagName === 'lang') {
        if (!isEnd) {
          langStack.push(currentLang);
          const langMatch = attr?.match(/xml:lang="([^"]+)"/);
          if (langMatch) {
            currentLang = langMatch[1]!;
          }
        } else {
          currentLang = langStack.pop() ?? defaultLang;
        }
      }
    }
  }

  return { plainText, marks };
};

export const findSSMLMark = (charIndex: number, marks: TTSMark[]) => {
  let left = 0;
  let right = marks.length - 1;
  let result: TTSMark | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const mark = marks[mid]!;

    if (mark.offset <= charIndex) {
      result = mark;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

export const filterSSMLWithLang = (
  ssml: string,
  targetLang: string,
  primaryLang?: string,
): string => {
  const mainLang = parseSSMLLang(ssml, primaryLang);

  // Normalize target language
  const normalizedTarget = code6392to6391(targetLang.toLowerCase()) || targetLang.toLowerCase();

  // Check if target matches main language
  if (isSameLang(normalizedTarget, mainLang)) {
    // Remove all <lang> blocks that don't match the main language
    return ssml.replace(/<lang\s+xml:lang="([^"]+)"[^>]*>.*?<\/lang>/gs, (match, langAttr) => {
      const blockLang = code6392to6391(langAttr.toLowerCase()) || langAttr.toLowerCase();
      // If the lang block matches the main language, keep it as is
      if (isSameLang(blockLang, mainLang)) {
        return match;
      }
      // Otherwise remove the entire block
      return '';
    });
  }

  // Check if target matches any <lang> block
  const langBlocks: Array<{ match: string; lang: string; content: string }> = [];
  // Also capture the <mark> that immediately precedes a <lang> block: foliate
  // emits the translated sentence's mark just OUTSIDE (before) its <lang> block,
  // so grabbing it keeps each French sentence attached to its OWN mark — the
  // highlight range then lines up with the spoken text instead of pointing at
  // the source sentence.
  const langBlockRegex = /(<mark\b[^>]*\/?>\s*)?<lang\s+xml:lang="([^"]+)"[^>]*>(.*?)<\/lang>/gs;
  let match: RegExpExecArray | null;

  const tempRegex = new RegExp(langBlockRegex.source, langBlockRegex.flags);
  while ((match = tempRegex.exec(ssml)) !== null) {
    const blockLang = code6392to6391(match[2]!.toLowerCase()) || match[2]!.toLowerCase();
    if (isSameLang(blockLang, normalizedTarget)) {
      langBlocks.push({
        match: match[0]!, // includes the preceding <mark> when present
        lang: match[2]!,
        content: match[3]!,
      });
    }
  }

  if (langBlocks.length > 0) {
    const speakOpenMatch = ssml.match(/<speak[^>]*>/i);
    const speakCloseMatch = ssml.match(/<\/speak>/i);

    if (!speakOpenMatch || !speakCloseMatch) {
      return ssml;
    }

    // Each block now carries its own preceding <mark>, so the rebuilt utterance
    // has the correct per-sentence marks (highlight lines up with the French).
    const combinedContent = langBlocks.map((block) => block.match).join('');
    // Fallback: if no block had a preceding mark, inject one leading mark so the
    // chunk still has a mark and isn't skipped by the controller.
    const markTag = /<mark\b/i.test(combinedContent) ? '' : '<mark name="0"/>';
    return `${speakOpenMatch[0]}${markTag}${combinedContent}${speakCloseMatch[0]}`;
  }

  // Reading a translation (target differs from the section's main language) but
  // this chunk has no matching <lang> block — e.g. at a chapter boundary before
  // the async translation is injected, or a paragraph the translator left as-is.
  // Returning the unfiltered SSML here made TTS fall back to reading the SOURCE
  // language, producing the source/translation mixing heard when changing
  // chapters. Return an empty utterance instead so the chunk is skipped (the
  // controller advances on empty marks) rather than read in the wrong language.
  const emptyOpen = ssml.match(/<speak[^>]*>/i);
  const emptyClose = ssml.match(/<\/speak>/i);
  if (emptyOpen && emptyClose) {
    return `${emptyOpen[0]}${emptyClose[0]}`;
  }
  return '';
};
