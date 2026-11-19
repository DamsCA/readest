import { TranslatorName } from './providers';

export interface TranslationProvider {
  name: string;
  label: string;
  authRequired?: boolean;
  quotaExceeded?: boolean;
  /**
   * Marks a provider as temporarily unavailable. Disabled providers are
   * filtered out of `getTranslators()` / `getTranslator()`, so the UI never
   * lists them and the fallback logic in `useTranslator` skips over them.
   * Flip back to `false` (or delete the field) once the provider is healthy
   * again — no other code changes required.
   */
  disabled?: boolean;
  /**
   * Rewrites a book in its own language instead of translating it (the
   * "Rewrite" switch of the language settings): never listed among the
   * translators, never fallen back to.
   */
  sameLanguage?: boolean;
  translate: (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    token?: string | null,
    useCache?: boolean,
  ) => Promise<string[]>;
}

export interface TranslationCache {
  [key: string]: string;
}

export interface UseTranslatorOptions {
  provider?: TranslatorName;
  sourceLang?: string;
  targetLang?: string;
  enablePolishing?: boolean;
  enablePreprocessing?: boolean;
}

export const ErrorCodes = {
  UNAUTHORIZED: 'Unauthorized',
  DEEPL_API_ERROR: 'DeepL API Error',
  DAILY_QUOTA_EXCEEDED: 'Daily Quota Exceeded',
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
};
