import type { AppStateStatus } from 'react-native';
import type * as Native from 'react-native';
type NativePort = {
  Linking: Pick<typeof Native.Linking, 'getInitialURL' | 'addEventListener'>;
  AppState: {
    addEventListener: (
      type: 'change',
      listener: (state: AppStateStatus) => void
    ) => ReturnType<typeof Native.AppState.addEventListener>;
  };
};
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The link that launched the process, and the listeners `listen` registers for the rest.
const linking = {
  initialUrl: null as string | null,
  onUrl: [] as ((event: { url: string }) => void)[],
  onAppState: [] as ((state: AppStateStatus) => void)[],
};
const openWith = (url: string) => linking.onUrl.forEach((listener) => listener({ url }));
const appGoes = (state: AppStateStatus) =>
  linking.onAppState.forEach((listener) => listener(state));

vi.mock<NativePort>(import('react-native'), () => ({
  Linking: {
    getInitialURL: async () => linking.initialUrl,
    addEventListener: (_, listener) => {
      linking.onUrl.push(listener);
      return { remove() {} };
    },
  },
  AppState: {
    addEventListener: (_, listener) => {
      linking.onAppState.push(listener);
      return { remove() {} };
    },
  },
}));

const EMAIL =
  'https://example.com/pricing?utm_source=lifecycle&utm_medium=email&utm_campaign=day3&fbclid=F1';

async function load() {
  const { deepLink } = await import('./deep-link');
  return deepLink;
}

beforeEach(() => {
  vi.resetModules(); // the link lives in module scope
  linking.initialUrl = null;
  linking.onUrl.length = 0;
  linking.onAppState.length = 0;
});

describe('deepLink', () => {
  it('registers nothing until listen, and its listeners once however often it is called', async () => {
    const deepLink = await load();
    expect(linking.onUrl).toHaveLength(0);

    deepLink.listen();
    deepLink.listen();
    expect(linking.onUrl).toHaveLength(1);
    expect(linking.onAppState).toHaveLength(1);
  });

  it('tags the link that launched the app: its URL and utm, no other parameter', async () => {
    linking.initialUrl = EMAIL;
    const deepLink = await load();

    await expect(deepLink.getTags()).resolves.toEqual({
      page_location: EMAIL,
      utm_source: 'lifecycle',
      utm_medium: 'email',
      utm_campaign: 'day3',
    });
  });

  it('takes a link that brings the running app to the front, over the launch one', async () => {
    linking.initialUrl = EMAIL;
    const deepLink = await load();
    deepLink.listen();
    await deepLink.getTags();

    openWith('myapp://pricing?utm_source=onesignal&utm_medium=push#top');
    await expect(deepLink.getTags()).resolves.toEqual({
      page_location: 'myapp://pricing?utm_source=onesignal&utm_medium=push#top',
      utm_source: 'onesignal',
      utm_medium: 'push',
    });
  });

  it('keeps a link that arrives before the first event', async () => {
    const deepLink = await load();
    deepLink.listen();

    openWith('myapp://?utm_source=lifecycle&utm_medium=sms');
    await expect(deepLink.getTags()).resolves.toMatchObject({ utm_medium: 'sms' });
  });

  it('ends the visit when the app goes to the background, not when it is only inactive', async () => {
    linking.initialUrl = EMAIL;
    const deepLink = await load();
    deepLink.listen();
    await deepLink.getTags();

    appGoes('inactive');
    await expect(deepLink.getTags()).resolves.toMatchObject({ page_location: EMAIL });

    appGoes('background');
    await expect(deepLink.getTags()).resolves.toEqual({});
  });

  it('takes a link handed over by hand, as from a push notification', async () => {
    const deepLink = await load();

    deepLink.open('https://example.com/?utm_source=lifecycle&utm_medium=push');
    await expect(deepLink.getTags()).resolves.toMatchObject({ utm_medium: 'push' });
  });

  it('strips credential parameters from the link it reports', async () => {
    linking.initialUrl = 'myapp://auth/callback?code=abc&state=xyz&utm_source=mail';
    await expect((await load()).getTags()).resolves.toEqual({
      page_location: 'myapp://auth/callback?utm_source=mail',
      utm_source: 'mail',
    });
  });

  it('keeps a link without parameters as the landing page and nothing else', async () => {
    linking.initialUrl = 'https://example.com/refer/abc123';
    const deepLink = await load();

    await expect(deepLink.getTags()).resolves.toEqual({
      page_location: 'https://example.com/refer/abc123',
    });
  });
});
