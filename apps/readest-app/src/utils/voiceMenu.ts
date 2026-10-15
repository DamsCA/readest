import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';
import { TRANSLATOR_LANGS } from '@/services/constants';
import { getLanguageName } from '@/utils/lang';

// The TTS voice menu. Each sentence is read by the voice of its own language,
// so the menu offers one choice per language: in a translated book, an English
// voice for the English and a French one for the French. It used to show a
// single tick, as if only one voice could be chosen (reported 15 Oct 2026).

export const baseLang = (lang: string) => (lang || '').toLowerCase().split('-')[0] || '';

/** The language's own name ("English", "Français"), as the language menus show it. */
export const languageLabel = (lang: string) => TRANSLATOR_LANGS[lang] ?? getLanguageName(lang);

/** One group per engine, whichever languages its voices were asked for. */
export const mergeVoiceGroups = (groups: TTSVoicesGroup[]): TTSVoicesGroup[] => {
  const merged = new Map<string, TTSVoicesGroup>();
  for (const group of groups) {
    const known = merged.get(group.id);
    if (!known) {
      merged.set(group.id, { ...group, voices: [...group.voices] });
      continue;
    }
    for (const voice of group.voices) {
      if (!known.voices.some((v) => v.id === voice.id)) known.voices.push(voice);
    }
    known.disabled = !!known.disabled && !!group.disabled;
  }
  return [...merged.values()];
};

/** An engine's voices by language, in the order it lists them. */
export const byLanguage = (voices: TTSVoice[]): [string, TTSVoice[]][] => {
  const sections = new Map<string, TTSVoice[]>();
  for (const voice of voices) {
    const lang = baseLang(voice.lang);
    sections.set(lang, [...(sections.get(lang) ?? []), voice]);
  }
  return [...sections.entries()];
};
