import { AppState, Linking } from 'react-native';
import { URLSearchParams } from 'react-native-url-polyfill';
import type { DeepLink } from '../setup/index';
import type { TrackTags } from '../track/types';
import { urlTags } from '../track/url-tags';

/**
 * The link that opened the app for this visit, the app's landing page: `getTags` merges its URL
 * (as `page_location`), utm and click ids into every event's tags, so the session it starts is
 * classified as a web page's URL would be. A universal link or an app link from an email or an ad
 * opens the app rather than the site, and without this every one of those sessions was direct.
 *
 * The visit lasts from the open to the app going to the background, so every event in between
 * carries the link, as every event of a web page carries that page's query; the next open, with a
 * link or without, starts from nothing. Only the event that starts a session gets it classified:
 * a link tapped while the session is still running joins it, as GA4 keeps one session across a
 * change of campaign.
 *
 * Read from React Native's `Linking`: the URL that launched the process, and each one that brings
 * the running app to the front. Pass it to `setupAnalytics({ deepLink })`, which starts the
 * listening; nothing happens at import.
 */
let openUrl: string | undefined;
let initialUrlPromise: Promise<void> | undefined;
let listening = false;

/** The URL that launched the process, read once; a link that arrived since has the last word. */
function resolveInitialUrl(): Promise<void> {
  initialUrlPromise ??= Linking.getInitialURL().then(
    (url) => {
      if (url && openUrl === undefined) openUrl = url;
    },
    () => undefined
  );
  return initialUrlPromise;
}

export const deepLink: DeepLink & {
  /** The link this visit opened with, for an entry `Linking` does not see, such as a push notification. */
  open: (url: string | null | undefined) => void;
} = {
  listen() {
    if (listening) return;
    listening = true;
    Linking.addEventListener('url', ({ url }) => deepLink.open(url));
    // `background`, not `inactive`: iOS goes inactive for a system sheet or the control center,
    // with the visit still on.
    AppState.addEventListener('change', (state) => {
      if (state === 'background') openUrl = undefined;
    });
  },
  /** Waits for the launch URL, so the first event of a launch has it. */
  async getTags(): Promise<TrackTags> {
    await resolveInitialUrl();
    if (!openUrl) return {};
    const at = openUrl.indexOf('?');
    const query = at === -1 ? '' : openUrl.slice(at + 1).split('#')[0];
    return { page_location: openUrl, ...urlTags(new URLSearchParams(query)) };
  },
  open(url) {
    openUrl = url || undefined;
  },
};
