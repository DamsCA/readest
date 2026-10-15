import { describe, it, expect, vi, beforeEach } from 'vitest';

// Which Fish Audio voice reads what: English by a native English voice, French
// by Claire, unless the reader picked another voice for that language.

const preferred: Record<string, string> = {};
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(
      (_engine: string, lang: string) => preferred[lang.slice(0, 2)] ?? null,
    ),
    sortVoicesPreferLocaleFunc: vi.fn(() => () => 0),
  },
}));
vi.mock('@/utils/misc', () => ({ getUserLocale: vi.fn((lang: string) => lang) }));
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => '/api',
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

import { FishAudioTTSClient } from '@/services/tts/FishAudioTTSClient';

const CLAIRE = 'da05ae30d8c0428eb47498df524e448c';
const SARAH = '933563129e564b19a115bedd57b7406a';
const LAURA = 'e3cd384158934cc9a01029cd7d278634';

describe('Fish Audio voices', () => {
  beforeEach(() => {
    for (const key of Object.keys(preferred)) delete preferred[key];
  });

  it('reads English with a native English voice and French with Claire', () => {
    const client = new FishAudioTTSClient();
    expect(client.getVoiceIdFromLang('en')).toBe(SARAH);
    expect(client.getVoiceIdFromLang('en-GB')).toBe(SARAH);
    expect(client.getVoiceIdFromLang('fr')).toBe(CLAIRE);
    // A language with no voice of its own keeps the current one.
    expect(client.getVoiceIdFromLang('de')).toBe(CLAIRE);
  });

  it('follows the voice the reader picked for a language, and only for it', () => {
    preferred['en'] = LAURA;
    const client = new FishAudioTTSClient();
    expect(client.getVoiceIdFromLang('en')).toBe(LAURA);
    expect(client.getVoiceIdFromLang('fr')).toBe(CLAIRE);
  });

  it("lists the language's own voices first, every other voice after", async () => {
    const client = new FishAudioTTSClient();
    const [group] = await client.getVoices('en');
    const langs = group!.voices.map((v) => v.lang);
    expect(langs.slice(0, 5)).toEqual(['en-US', 'en-US', 'en-US', 'en-US', 'en-US']);
    expect(group!.voices.at(-1)!.id).toBe(CLAIRE);
  });
});
