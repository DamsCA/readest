import { describe, it, expect, vi } from 'vitest';

// The AI translator reads the relay address at module load, so the environment
// must be set before the registry is imported.
vi.hoisted(() => {
  process.env['NEXT_PUBLIC_FISH_RELAY_URL'] = 'https://relay.test/';
});
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  getAPIBaseUrl: () => 'https://api.example.com',
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
// deepl.ts -> @/utils/access -> @/utils/supabase would start a real client.
vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import {
  getTranslators,
  isTranslatorAvailable,
  resolveTranslator,
} from '@/services/translators/providers';

// Reported 15 Oct 2026: the list said "DeepL (Quota Exceeded)" and paragraphs
// stayed in English. DeepL gives a free Readest account 10,240 characters a day,
// and its quota then switched the reader to Azure, whose token endpoint answers
// 404, so nothing was translated any more.
describe('translators with the relay', () => {
  it('does not offer DeepL next to the AI translator', () => {
    const names = getTranslators().map((t) => t.name);
    expect(names[0]).toBe('ai');
    expect(names).not.toContain('deepl');
  });

  it('reads a book set to DeepL with the AI translator, even signed in', () => {
    expect(resolveTranslator('deepl', true)?.name).toBe('ai');
    expect(resolveTranslator('deepl', false)?.name).toBe('ai');
  });

  it('never chooses Azure, whose service is gone', () => {
    const azure = getTranslators().find((t) => t.name === 'azure')!;
    expect(azure.disabled).toBe(true);
    expect(isTranslatorAvailable(azure, true)).toBe(false);
    expect(resolveTranslator('azure', true)?.name).toBe('ai');
  });

  it('still lets Google be chosen', () => {
    expect(resolveTranslator('google', false)?.name).toBe('google');
  });
});
