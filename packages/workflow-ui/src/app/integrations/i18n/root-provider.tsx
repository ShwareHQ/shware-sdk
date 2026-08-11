import { createInstance, type i18n } from 'i18next';
import languageDetector from 'i18next-browser-languagedetector';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import enUS from '../../locales/en-US/common';
import zhCN from '../../locales/zh-CN/common';

/**
 * Studio interface copy.
 *
 * Locales are imported statically rather than fetched by a backend plugin:
 * there are two of them and the studio is a dev tool, so bundling both beats
 * an extra request and the loading state that comes with it.
 */
export const defaultNS = 'common';

export const supportedLngs = ['en-US', 'zh-CN'] as const;
export type SupportedLng = (typeof supportedLngs)[number];

export const languageNames: Record<SupportedLng, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
};

const resources = {
  'en-US': { common: enUS },
  'zh-CN': { common: zhCN },
};

export function getI18nContext(): { i18n: i18n } {
  const i18n = createInstance();

  i18n.on('languageChanged', (lang) => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  });

  void i18n
    .use(initReactI18next)
    .use(languageDetector)
    .init({
      resources,
      ns: [defaultNS],
      defaultNS,
      supportedLngs: [...supportedLngs],
      /*
       * English is the default; a browser reporting a bare `zh` still lands on
       * zh-CN. Note this must not be `nonExplicitSupportedLngs` — that strips
       * the region off the *detected* code before testing it against
       * supportedLngs, so `en-US` becomes `en`, matches nothing here, and every
       * lookup falls through to the raw key.
       */
      fallbackLng: { zh: ['zh-CN'], 'zh-Hans': ['zh-CN'], default: ['en-US'] },
      detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
      interpolation: { escapeValue: false },
    });

  return { i18n };
}

export function I18nProvider({ i18n, children }: { i18n: i18n; children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
