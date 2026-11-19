import { describe, it, expect, vi, beforeEach } from 'vitest';

// The rewriter reads the relay address at module load (it is disabled without
// one), so the environment must be set before the import below.
vi.hoisted(() => {
  process.env['NEXT_PUBLIC_FISH_RELAY_URL'] = 'https://relay.test/';
  process.env['NEXT_PUBLIC_FISH_RELAY_TOKEN'] = 'token';
});

const mockFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => mockFetch(...a) }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));

import { aiRewriteProvider, resetAITranslationPause } from '@/services/translators/providers/ai';
import {
  getTranslators,
  isTranslatorAvailable,
  resolveTranslator,
} from '@/services/translators/providers';
import { isTranslationAvailable } from '@/services/translators/utils';
import { Book } from '@/types/book';

// The rewrite of a book already in the reader's language (relay /v1/rewrite):
// "Comment se faire des amis", whose French was badly transcribed (19 Nov 2026).

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const AWKWARD = "Quand il l'entend,il s'écrie que c'est trop cher.";
const FIXED = "Quand il l'entend, il s'écrie que c'est trop cher.";

describe('the rewriter (relay /v1/rewrite)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetAITranslationPause();
  });

  it('sends each paragraph with the language of the book', async () => {
    mockFetch.mockResolvedValue(reply(200, { rewrite: FIXED }));
    const out = await aiRewriteProvider.translate([AWKWARD], 'AUTO', 'fr-FR');
    expect(out).toEqual([FIXED]);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://relay.test/v1/rewrite');
    expect(JSON.parse(String(init.body))).toEqual({ text: AWKWARD, lang: 'fr-FR' });
    expect(init.headers['X-Relay-Token']).toBe('token');
  });

  it('leaves titles and other short texts as they are, without asking', async () => {
    const out = await aiRewriteProvider.translate(['Chapitre 3', ''], 'AUTO', 'fr');
    expect(out).toEqual(['Chapitre 3', '']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Never the paragraph itself: the cache would keep it as its rewrite, and it
  // would never be asked for again.
  it('gives back nothing for a paragraph it could not rewrite', async () => {
    mockFetch.mockResolvedValue(reply(502, { error: 'upstream' }));
    expect(await aiRewriteProvider.translate([AWKWARD], 'AUTO', 'fr')).toEqual(['']);
  });

  it('stops asking once the free allocation of the day is used up', async () => {
    mockFetch.mockResolvedValue(reply(429, { error: 'daily free allocation exhausted' }));
    await aiRewriteProvider.translate([AWKWARD], 'AUTO', 'fr');
    mockFetch.mockClear();
    expect(await aiRewriteProvider.translate([AWKWARD], 'AUTO', 'fr')).toEqual(['']);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('the rewriter among the translators', () => {
  it('is never offered as a translator, nor fallen back to', () => {
    const listed = getTranslators().filter((t) => !t.sameLanguage);
    expect(listed.map((t) => t.name)).not.toContain('ai-rewrite');
    expect(resolveTranslator('deepl', false)?.name).toBe('ai');
  });

  it('is what a book set to rewrite uses', () => {
    const rewriter = resolveTranslator('ai-rewrite', false);
    expect(rewriter?.name).toBe('ai-rewrite');
    expect(isTranslatorAvailable(rewriter!, false)).toBe(true);
  });

  it('works on a book in the reader’s own language, which translation refuses', () => {
    const book = { format: 'EPUB', primaryLanguage: 'fr-FR' } as Book;
    expect(isTranslationAvailable(book, 'fr')).toBe(false);
    expect(isTranslationAvailable(book, 'fr', 'ai-rewrite')).toBe(true);
  });
});
