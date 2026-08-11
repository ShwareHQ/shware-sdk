import 'i18next';
import type common from '../../locales/en-US/common';
import type { defaultNS } from './root-provider';

/** en-US is the source of truth for key names, so a missing key fails to compile. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: { common: typeof common };
  }
}
