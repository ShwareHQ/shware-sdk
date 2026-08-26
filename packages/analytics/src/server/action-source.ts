import type { Platform } from '../track/types';

/**
 * The coarse "where did this happen" categorization every conversions API asks for, under its
 * own name and its own spelling: Meta `action_source`, Reddit `action_source`, OpenAI
 * `action_source`. Each sender maps this to its vendor vocabulary.
 */
export type ActionSource = 'web' | 'app';

/**
 * What a caller may state explicitly. `offline` is deliberately absent from the derived set:
 * it describes how a conversion was collected — in store, imported from a CRM, taken over the
 * phone — not what device it came from, so no platform implies it. Such events are built by a
 * backend rather than reported by a client SDK, which is why the sender takes it as an argument.
 */
export type EventActionSource = ActionSource | 'offline';

/**
 * An OS name means the event came from a native app, `web` means a browser page. A caller that
 * declares `macos`/`windows`/`linux` is declaring a desktop app — a page running in a webview
 * should declare `web`.
 *
 * `unknown` maps to nothing, since no vendor value fits; each sender picks its own fallback.
 */
function getActionSource(platform: Platform): ActionSource | undefined {
  switch (platform) {
    case 'web':
      return 'web';
    case 'ios':
    case 'android':
    case 'macos':
    case 'windows':
    case 'linux':
      return 'app';
    case 'unknown':
      return undefined;
  }
}

/** An explicit action source always wins; otherwise it is derived from the event's platform. */
export function resolveActionSource(
  platform: Platform,
  actionSource?: EventActionSource
): EventActionSource | undefined {
  return actionSource ?? getActionSource(platform);
}
