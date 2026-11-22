import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import translatableLngs from '../../i18n-langs.json';
import { initReactI18next } from 'react-i18next';
import { APP_DISPLAY_NAME } from '@/services/constants';

// 'en' is the source language and not listed in the translatable set.
const SUPPORTED_LNGS = ['en', ...translatableLngs];

const isBrowser = typeof window !== 'undefined';

// The app is published under its own name: every displayed text says APP_DISPLAY_NAME
// instead of "Readest". The one exception is the AGPL notice naming the original work.
const brandName = {
  type: 'postProcessor' as const,
  name: 'brandName',
  process: (value: string, key: string | string[]) => {
    const k = Array.isArray(key) ? key.join(' ') : key;
    if (k.includes('modified version of Readest')) return value;
    return value.replace(/Readest/g, APP_DISPLAY_NAME);
  },
};

const initI18n = async () => {
  if (isBrowser) {
    const HttpApi = (await import('i18next-http-backend')).default;
    i18n.use(HttpApi);
  }

  i18n
    .use(brandName)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      supportedLngs: SUPPORTED_LNGS,
      fallbackLng: {
        'zh-HK': ['zh-TW', 'en'],
        'pt-BR': ['pt', 'en'],
        kk: ['ru', 'en'],
        ky: ['ru', 'en'],
        tk: ['ru', 'en'],
        ug: ['ru', 'en'],
        tt: ['ru', 'en'],
        default: ['en'],
      },
      ns: ['translation'],
      defaultNS: 'translation',
      ...(isBrowser && {
        backend: {
          loadPath: '/locales/{{lng}}/{{ns}}.json',
        },
      }),
      detection: {
        order: ['querystring', 'localStorage', 'navigator'],
        caches: ['localStorage'],
      },
      postProcess: ['brandName'],
      keySeparator: false,
      nsSeparator: false,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });

  i18n.on('languageChanged', (lng) => {
    if (typeof window !== 'undefined') {
      console.log('Language changed to', lng);
    }
  });
};

initI18n();

export default i18n;
