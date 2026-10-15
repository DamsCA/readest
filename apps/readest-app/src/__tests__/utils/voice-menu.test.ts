import { describe, it, expect } from 'vitest';
import type { TTSVoicesGroup } from '@/services/tts/types';
import { baseLang, byLanguage, languageLabel, mergeVoiceGroups } from '@/utils/voiceMenu';

const sarah = { id: 'sarah', name: 'Sarah', lang: 'en-US' };
const selene = { id: 'selene', name: 'Selene', lang: 'en-US' };
const claire = { id: 'claire', name: 'Claire', lang: 'fr-FR' };
const aria = { id: 'aria', name: 'Aria', lang: 'en-US' };
const denise = { id: 'denise', name: 'Denise', lang: 'fr-FR' };

describe('voice menu', () => {
  // Reported 15 Oct 2026: one tick for the whole menu, as if a translated book
  // could only have one voice. Each language now has its own.
  it('splits an engine into one section per language, in its order', () => {
    expect(byLanguage([sarah, selene, claire])).toEqual([
      ['en', [sarah, selene]],
      ['fr', [claire]],
    ]);
  });

  it('merges the voices asked for each language into one group per engine', () => {
    const forEnglish: TTSVoicesGroup[] = [
      { id: 'fish-audio', name: 'Fish Audio', voices: [sarah, selene, claire] },
      { id: 'edge-tts', name: 'Edge TTS', voices: [aria] },
    ];
    const forFrench: TTSVoicesGroup[] = [
      { id: 'fish-audio', name: 'Fish Audio', voices: [claire, sarah, selene] },
      { id: 'edge-tts', name: 'Edge TTS', voices: [denise] },
    ];
    const merged = mergeVoiceGroups([...forEnglish, ...forFrench]);
    expect(merged.map((g) => g.id)).toEqual(['fish-audio', 'edge-tts']);
    expect(merged[0]!.voices).toEqual([sarah, selene, claire]);
    expect(merged[1]!.voices).toEqual([aria, denise]);
  });

  it('does not change the groups it merges', () => {
    const group: TTSVoicesGroup = { id: 'edge-tts', name: 'Edge TTS', voices: [aria] };
    mergeVoiceGroups([group, { ...group, voices: [denise] }]);
    expect(group.voices).toEqual([aria]);
  });

  it('names each language in its own words', () => {
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel('fr')).toBe('Français');
    expect(baseLang('fr-FR')).toBe('fr');
  });
});
