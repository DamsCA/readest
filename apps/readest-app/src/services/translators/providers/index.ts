import { TranslationProvider } from '../types';
import { aiProvider } from './ai';
import { deeplProvider } from './deepl';
import { azureProvider } from './azure';
import { googleProvider } from './google';
import { yandexProvider } from './yandex';

function createTranslator<T extends string>(
  name: T,
  implementation: TranslationProvider,
): TranslationProvider & { name: T } {
  if (name !== implementation.name) {
    throw Error(
      `Translator name "${name}" does not match implementation name "${implementation.name}"`,
    );
  }
  return implementation as TranslationProvider & { name: T };
}

const aiTranslator = createTranslator('ai', aiProvider);
const deeplTranslator = createTranslator('deepl', deeplProvider);
const azureTranslator = createTranslator('azure', azureProvider);
const googleTranslator = createTranslator('google', googleProvider);
const yandexTranslator = createTranslator('yandex', yandexProvider);

// First available wins whenever the configured provider is unusable (e.g. the
// DeepL default without a Readest account): the AI translator renders idioms
// naturally instead of word for word, and is only listed when the relay exists.
const availableTranslators = [
  aiTranslator,
  deeplTranslator,
  azureTranslator,
  googleTranslator,
  yandexTranslator,
  // Add more translators here
];

export type TranslatorName = (typeof availableTranslators)[number]['name'];

// With the relay, the AI translator does what DeepL cannot do here: through
// Readest's server a free account gets 10,240 characters of DeepL a day, a few
// pages, after which the list said "DeepL (Quota Exceeded)" and the paragraphs
// stayed in English (reported 15 Oct 2026). Builds without the relay keep it.
const listedTranslators = availableTranslators.filter(
  (t) => !(t.name === 'deepl' && !aiTranslator.disabled),
);

export const getTranslator = (name: TranslatorName): TranslationProvider | undefined => {
  return listedTranslators.find((translator) => translator.name === name);
};

export const getTranslators = (): TranslationProvider[] => {
  return listedTranslators;
};

/**
 * Single source of truth for "can this provider actually be used right now?".
 * Used by auto-selection / fallback logic in `useTranslator`, the settings
 * panel, and the translator popup. Disabled providers (e.g. temporarily down
 * upstream services) are still returned from `getTranslators()` so the UI can
 * render them greyed out, but this predicate excludes them so they can never
 * be chosen or fallen back to.
 */
export const isTranslatorAvailable = (
  translator: TranslationProvider,
  hasToken: boolean,
): boolean => {
  if (translator.disabled) return false;
  if (translator.quotaExceeded) return false;
  if (translator.authRequired && !hasToken) return false;
  return true;
};

/**
 * The provider actually used for `provider`: itself when available, otherwise
 * the first available one — the rule `useTranslator` applies to the reader's
 * own translations. Code translating outside that hook (the TTS chapter
 * prefetch) must resolve the same way, or it caches under another provider
 * and, with the DeepL default and no Readest account, cannot translate at all.
 */
export const resolveTranslator = (
  provider: string,
  hasToken: boolean,
): TranslationProvider | undefined => {
  const available = listedTranslators.filter((t) => isTranslatorAvailable(t, hasToken));
  return available.find((t) => t.name === provider) ?? available[0];
};

/**
 * Builds the user-facing dropdown label for a provider, appending a short
 * status suffix when the provider is unavailable. Kept next to
 * `isTranslatorAvailable` so the two stay in sync when a new unavailability
 * reason is added. The `_` translation function is passed in so this module
 * stays free of React imports.
 */
export const getTranslatorDisplayLabel = (
  translator: TranslationProvider,
  hasToken: boolean,
  _: (key: string) => string,
): string => {
  // In the reader's language: the list showed "AI (natural)" in English.
  const label = _(translator.label);
  if (translator.disabled) {
    return label;
  }
  if (translator.authRequired && !hasToken) {
    return `${label} (${_('Login Required')})`;
  }
  if (translator.quotaExceeded) {
    return `${label} (${_('Quota Exceeded')})`;
  }
  return label;
};
