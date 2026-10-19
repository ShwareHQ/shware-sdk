import { Activity, useEffect, useState } from 'react';
import { useAppAnalytics } from '../../hooks/use-app-analytics';
import { useWebAnalytics } from '../../hooks/use-web-analytics';

// These helpers use the .test suffix so tsdown excludes them from the published SDK.
// The Vitest projects collect only compiler.test.tsx; this is a compiled caller fixture.
export { compilerReports } from './reports.test';

function location() {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function WebPage({ pathname, search }: { pathname: string; search: string }) {
  useWebAnalytics(pathname, search);
  return <output>{pathname}</output>;
}

export function NativeScreen({ pathname }: { pathname: string; search: string }) {
  useAppAnalytics(pathname);
  return <output>{pathname}</output>;
}

export function App({ native }: { native: boolean }) {
  const [mode, setMode] = useState<'visible' | 'hidden'>('visible');
  const [{ pathname, search }, setLocation] = useState(location);
  const Page = native ? NativeScreen : WebPage;

  useEffect(() => {
    const navigate = () => setLocation(location());
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);

  function navigate(href: string) {
    window.history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <>
      <button type="button" onClick={() => navigate('/b')}>
        Navigate B
      </button>
      <button type="button" onClick={() => navigate('/c')}>
        Navigate C
      </button>
      <button type="button" onClick={() => window.history.back()}>
        Back
      </button>
      <button type="button" onClick={() => setMode('hidden')}>
        Hide
      </button>
      <button type="button" onClick={() => setMode('visible')}>
        Reveal
      </button>
      <Activity mode={mode}>
        <Page pathname={pathname} search={search} />
      </Activity>
    </>
  );
}
