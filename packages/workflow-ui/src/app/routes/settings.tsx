import { createRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/button';
import { superellipse } from '../../components/corner-shape';
import {
  type SupportedLng,
  languageNames,
  supportedLngs,
} from '../integrations/i18n/root-provider';
import { type Theme, themes, useTheme } from '../integrations/theme/root-provider';
import { Route as rootRoute } from './__root';

function Settings() {
  const { config } = settingsRoute.useRouteContext();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();

  const current = supportedLngs.find((lng) => i18n.resolvedLanguage === lng) ?? 'en-US';
  const sources = (['reports', 'nodeStats', 'metrics'] as const).filter(
    (key) => config.stats?.[key] !== undefined
  );

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="text-lg font-semibold">{t('settings.title')}</h1>

      <section
        className="border-border bg-card mt-5 max-w-xl rounded-2xl border p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.language')}</h2>
        <p className="text-muted mt-1 text-xs">{t('settings.languageHint')}</p>
        <div className="mt-3 flex gap-2">
          {supportedLngs.map((lng: SupportedLng) => (
            <Button
              key={lng}
              size="sm"
              variant={current === lng ? 'default' : 'secondary'}
              onClick={() => void i18n.changeLanguage(lng)}
            >
              {languageNames[lng]}
            </Button>
          ))}
        </div>
      </section>

      <section
        className="border-border bg-card mt-4 max-w-xl rounded-2xl border p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.theme')}</h2>
        <p className="text-muted mt-1 text-xs">{t('settings.themeHint')}</p>
        <div className="mt-3 flex gap-2">
          {themes.map((option: Theme) => (
            <Button
              key={option}
              size="sm"
              variant={theme === option ? 'default' : 'secondary'}
              onClick={() => setTheme(option)}
            >
              {t(`settings.themes.${option}`)}
            </Button>
          ))}
        </div>
      </section>

      <section
        className="border-border bg-card mt-4 max-w-xl rounded-2xl border p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.statsSource')}</h2>
        <p className="text-secondary mt-2 font-mono text-xs">
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
