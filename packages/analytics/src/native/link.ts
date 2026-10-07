import { AppState, Linking } from 'react-native';
import { URLSearchParams } from 'react-native-url-polyfill';
import { type UrlTags, urlTags } from '../track/url-tags';

/**
 * The link that opened the app for this visit, the app's landing page: its URL stands in for
 * `page_location`, and its utm and click ids name the session it starts, exactly as a web page's
 * query does. A universal link or an app link from an email or an ad opens the app rather than
 * the site, and without this every one of those sessions was direct.
 *
 * The visit lasts from the open to the app going to the background, so every event in between
 * carries the link, as every event of a web page carries that page's query; the next open, with a
 * link or without, starts from nothing. Only the event that starts a session gets it classified:
 * a link tapped while the session is still running joins it, as GA4 keeps one session across a
 * change of campaign.
 *
 * Read from React Native's `Linking`: the URL that launched the process, and each one that brings
 * the running app to the front. An entry the system does not route through `Linking` — a tap on
 * a push notification — hands its URL over with `openedWith`.
 */
let openUrl: string | undefined;
let initialUrlPromise: Promise<void> | undefined;

/** The link this visit opened with, for an entry `Linking` does not see, such as a push notification. */
export function openedWith(url: string | null | undefined): void {
  openUrl = url || undefined;
}

// Listening from the moment the module is imported, before any event: a link that brings the app
// to the front between the import and the first `getTags` is not lost, and the app has nothing to
// call. Neither listener touches storage, which may not exist yet at import.
Linking.addEventListener('url', ({ url }) => openedWith(url));
// `background`, not `inactive`: iOS goes inactive for a system sheet or the control center, with
// the visit still on.
AppState.addEventListener('change', (state) => {
  if (state === 'background') openUrl = undefined;
});

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

/**
 * The tags of the link that opened this visit: its URL as `page_location`, and its utm and click
 * ids. Empty without one. Waits for the launch URL, so the first event of a launch has it.
 */
export async function getOpenUrlTags(): Promise<UrlTags & { page_location?: string }> {
  await resolveInitialUrl();
  if (!openUrl) return {};
  const at = openUrl.indexOf('?');
  const query = at === -1 ? '' : openUrl.slice(at + 1).split('#')[0];
  return { page_location: openUrl, ...urlTags(new URLSearchParams(query)) };
}
