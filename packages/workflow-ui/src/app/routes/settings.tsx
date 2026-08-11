import { createRoute } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import {
  type SupportedLng,
  languageNames,
  supportedLngs,
} from '../integrations/i18n/root-provider';
import { Route as rootRoute } from './__root';

function Settings() {
  const { config } = settingsRoute.useRouteContext();
  const { t, i18n } = useTranslation();

  const current = supportedLngs.find((lng) => i18n.resolvedLanguage === lng) ?? 'en-US';
  const sources = (['reports', 'nodeStats', 'metrics'] as const).filter(
    (key) => config.stats?.[key] !== undefined
  );

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="text-lg font-semibold">{t('settings.title')}</h1>

      <section
        className="mt-5 max-w-xl rounded-xl border border-gray-200 bg-white p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.language')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t('settings.languageHint')}</p>
        <div className="mt-3 flex gap-2">
          {supportedLngs.map((lng: SupportedLng) => (
            <button
              key={lng}
              type="button"
              onClick={() => void i18n.changeLanguage(lng)}
              style={superellipse}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                current === lng
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {languageNames[lng]}
            </button>
          ))}
        </div>
      </section>

      <section
        className="mt-4 max-w-xl rounded-xl border border-gray-200 bg-white p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.statsSource')}</h2>
        <p className="mt-2 font-mono text-xs text-gray-600">
          {sources.length > 0 ? sources.join(', ') : t('common.notConfigured')}
        </p>
      </section>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});
