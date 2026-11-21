import { Book } from '@/types/book';
import { isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

const DAILY_USAGE_KEY = 'translationDailyUsage';

export const saveDailyUsage = (usage: number, date?: string) => {
  if (typeof window !== 'undefined') {
    const isoDate = date || new Date().toISOString().split('T')[0]!;
    const dailyUsage = { [isoDate]: usage };
    localStorage.setItem(DAILY_USAGE_KEY, JSON.stringify(dailyUsage));
  }
};

export const getDailyUsage = (date?: string): number | null => {
  if (typeof window !== 'undefined') {
    const isoDate = date || new Date().toISOString().split('T')[0]!;
    const usage = localStorage.getItem(DAILY_USAGE_KEY);
    if (usage) {
      const dailyUsage = JSON.parse(usage);
      if (dailyUsage[isoDate]) {
        return dailyUsage[isoDate];
      }
    }
  }
  return null;
};

export const isTranslationAvailable = (
  book?: Book | null,
  targetLanguage?: string | null,
  provider?: string | null,
) => {
  if (!book) {
    return false;
  }

  // The rewrite works in the book's own language (the "Rewrite" switch).
  if (provider === 'ai-rewrite') return true;

  const primaryLanguage = book.primaryLanguage || '';
  if (!primaryLanguage || primaryLanguage.toLowerCase() === 'und') {
    // A PDF seldom declares its language: text mode, which translation
    // switches on, detects it from the text itself.
    return book.format === 'PDF';
  }

  if (targetLanguage && isSameLang(primaryLanguage, targetLanguage)) {
    return false;
  }

  if (!targetLanguage && isSameLang(primaryLanguage, getLocale())) {
    return false;
  }

  return true;
};
