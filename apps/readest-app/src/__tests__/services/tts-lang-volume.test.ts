import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSUtils } from '@/services/tts/TTSUtils';

const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
};

// Reported 15 Oct 2026: the French voice much louder than the English one, and
// nothing to change it with.
describe('volume per language', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('is full until the reader sets it', () => {
    expect(TTSUtils.getLangVolume('fr')).toBe(1);
  });

  it('is kept per language, whatever the region', () => {
    TTSUtils.setLangVolume('fr-FR', 0.6);
    expect(TTSUtils.getLangVolume('fr')).toBe(0.6);
    expect(TTSUtils.getLangVolume('en-US')).toBe(1);
  });

  it('stays between silent and full', () => {
    TTSUtils.setLangVolume('en', 3);
    expect(TTSUtils.getLangVolume('en')).toBe(1);
    TTSUtils.setLangVolume('en', -1);
    expect(TTSUtils.getLangVolume('en')).toBe(0);
  });

  it('leaves the chosen voices alone', () => {
    TTSUtils.setPreferredVoice('fish-audio', 'en', 'sarah');
    TTSUtils.setLangVolume('en', 0.8);
    expect(TTSUtils.getPreferredVoice('fish-audio', 'en')).toBe('sarah');
  });
});
