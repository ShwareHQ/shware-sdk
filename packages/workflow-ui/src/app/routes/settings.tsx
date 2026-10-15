import { createRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '../../components/breadcrumb';
import { Button } from '../../components/button';
import { superellipse } from '../../components/corner-shape';
import { EmailDefaults } from '../../components/email-defaults';
import {
  type SupportedLng,
  languageNames,
  supportedLngs,
} from '../integrations/i18n/root-provider';
import { type Theme, themes, useTheme } from '../integrations/theme/root-provider';
import { PageChrome } from '../page-chrome';
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
    /* No scroll container of its own: the shell's content column is the only one. */
    <div className="flex-1 p-6">
      <PageChrome breadcrumb={<Breadcrumb items={[{ label: t('nav.settings') }]} />} />

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

      <EmailDefaults from={config.emailDefaults.from} replyTo={config.emailDefaults.replyTo} />

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
