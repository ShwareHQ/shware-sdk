import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../src/app/locales/en-US/common';

/**
 * Components read the shared i18next singleton through useTranslation, so the
 * suite initializes it once with the real English catalog — assertions then
 * check the exact copy users see, and a missing key surfaces as a raw
 * 'section.key' string in the output.
 */
await createInstance()
  .use(initReactI18next)
  .init({
    lng: 'en-US',
    resources: { 'en-US': { translation: en } },
    interpolation: { escapeValue: false },
  });
