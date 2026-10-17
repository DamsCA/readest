import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

const TIMEOUT_MS = 15_000;

export const googleProvider: TranslationProvider = {
  name: 'google',
  label: _('Google Translate'),
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const results: string[] = [];

    const translationPromises = text.map(async (line, index) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }

      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.append('client', 'gtx');
      url.searchParams.append('dt', 't');
      url.searchParams.append('sl', normalizeToShortLang(sourceLang).toLowerCase() || 'auto');
      url.searchParams.append('tl', normalizeToShortLang(targetLang).toLowerCase());
      url.searchParams.append('q', line);

      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      // A request left hanging must fail at some point: the reader's
      // translator and the voice wait on it.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let data: unknown;
      try {
        const response = await fetch(url.toString(), { signal: ctrl.signal });
        if (!response.ok) {
          throw new Error(`Translation failed with status ${response.status}`);
        }
        data = await response.json();
      } finally {
        clearTimeout(timer);
      }
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translatedText = data[0]
          .filter((segment) => Array.isArray(segment) && segment[0])
          .map((segment) => segment[0])
          .join('');

        results[index] = translatedText || line;
      } else {
        results[index] = line;
      }
    });

    await Promise.all(translationPromises);

    return results;
  },
};
