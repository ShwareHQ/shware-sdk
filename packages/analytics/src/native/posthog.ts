import type { Properties } from '@posthog/types';
import { PostHog, type PostHogOptions } from 'posthog-react-native';
import { PosthogErrorBoundaryBase } from '../react/error-boundary';
import type { UpdateVisitorDTO } from '../schema/index';
import type { Integration } from '../third-parties/integration';
import type { ErrorPattern } from '../third-parties/posthog';
import type { EventName, TrackName, TrackProperties } from '../track/types';
import { getFirst } from '../utils/field';

export type { PostHog, PostHogOptions } from 'posthog-react-native';
export type { ErrorPattern } from '../third-parties/posthog';
export type {
  PosthogErrorBoundaryFallbackProps,
  PosthogErrorBoundaryProps,
} from '../react/error-boundary';

type BeforeSend = Exclude<NonNullable<PostHogOptions['before_send']>, readonly unknown[]>;
type Autocapture = NonNullable<NonNullable<PostHogOptions['errorTracking']>['autocapture']>;

/** The app's one client, created by `posthogAnalytics`. */
let client: PostHog | undefined;

/**
 * The `posthog-react-native` client `posthogAnalytics` created, for what the integration does not
 * cover (feature flags, surveys, `PostHogProvider client={…}` for the library's own hooks);
 * `undefined` before it has been called.
 */
export function getPosthog(): PostHog | undefined {
  return client;
}

function sendPosthogEvent<T extends EventName>(
  name: TrackName<T>,
  properties?: TrackProperties<T>
) {
  if (!client) return false;
  client.capture(name, properties);
}

/**
 * As the web's `setPosthogUser`: identifies the person by the signed-in user's id only, never by
 * the anonymous visitor's, and without a user resets PostHog's identity (sign-out).
 */
function setPosthogUser({ user_id, user_data }: Omit<UpdateVisitorDTO, 'tags'>) {
  if (!client) return;
  if (!user_id) {
    client.reset();
    return;
  }
  const email = getFirst(user_data?.email);
  client.identify(user_id, email ? { email } : undefined);
}

/**
 * Sends an error to PostHog's error tracking (`captureException`), as the web's function of the
 * same name: from a `catch` that recovers but should still be known. A no-op before
 * `posthogAnalytics` has been called. Never throws: reporting an error must not become a second
 * one where it is called. The `errorTracking` filter of `posthogAnalytics` applies.
 */
export function capturePosthogException(error: unknown, properties?: Properties): void {
  try {
    client?.captureException(error, properties);
  } catch (e: unknown) {
    console.error('capturePosthogException: the error was not reported', e);
  }
}

/**
 * The web's `PosthogErrorBoundary`, with its props, for React Native: a render error in `children`
 * is sent to PostHog through the client `posthogAnalytics` created and `fallback` renders instead
 * — a component gets the error and `resetError`. The component stack goes in
 * `$exception_component_stack`, as `posthog-react-native`'s own boundary sends it (not as a cause:
 * its frames are not the bundle's, so they would not symbolicate). `exceptionEvent` is always
 * `undefined`: the library's `captureException` returns nothing.
 *
 * It reports each error once. React Native's root passes a caught error to `ExceptionsManager` as
 * non-fatal, which the library's autocapture does not send; only an error no boundary caught
 * reaches it, as a fatal one.
 */
export class PosthogErrorBoundary extends PosthogErrorBoundaryBase {
  protected override capture(
    error: unknown,
    componentStack: string,
    properties: Properties | undefined
  ): undefined {
    client?.captureException(error, {
      ...properties,
      ...(componentStack ? { $exception_component_stack: componentStack } : {}),
    });
    return undefined;
  }
}

export interface PosthogErrorTrackingOptions {
  /**
   * The library's exception autocapture: uncaught errors (React Native's global handler, which it
   * chains to the previous one, so the red box and the crash are unchanged) and Hermes' unhandled
   * rejections, on by default. Takes the library's options too (`nativeCrashes`, `console`). The
   * same as `config.errorTracking.autocapture`, which wins when both are set.
   */
  autocapture?: Autocapture;
  /**
   * Exceptions not sent, as Sentry's `ignoreErrors` and the web's option: matched against
   * `Type: message` and the message alone of each error in the chain (`$exception_list`).
   *
   * There is no `denyUrls`: every frame of an app's JavaScript is in the one bundle, so the file
   * of a frame cannot tell a third party's code from yours.
   */
  ignoreErrors?: readonly ErrorPattern[];
}

/**
 * The `before_send` that applies `errorTracking`: every `$exception` dropped when it is off, or the
 * ones `ignoreErrors` matches. `g` and `y` are dropped from a pattern's flags: they make `test`
 * resume from the last match, so one rule would match the same message only every other time.
 */
function exceptionFilter(off: boolean, ignoreErrors: readonly ErrorPattern[]): BeforeSend {
  const patterns = ignoreErrors.map((p) =>
    typeof p === 'string' ? p : new RegExp(p.source, p.flags.replace(/[gy]/g, ''))
  );
  const matches = (text: string) =>
    text !== '' && patterns.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text)));
  return (event) => {
    if (event.event !== '$exception') return event;
    if (off) return null;
    const list = event.properties?.$exception_list;
    if (!Array.isArray(list)) return event;
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const value = typeof entry.value === 'string' ? entry.value : '';
      const type = typeof entry.type === 'string' ? entry.type : '';
      if (matches(type ? `${type}: ${value}` : value) || matches(value)) return null;
    }
    return event;
  };
}

/**
 * PostHog for React Native: the app's counterpart of the web's `posthogAnalytics`, with the same
 * events (every `track`), the same identity (`identify` / `reset()`) and the same error tracking,
 * so both report to one project. It creates the `posthog-react-native` client, which batches and
 * stores events itself; `config` goes to it as is (`host`, `persistence`, `customAppProperties`, …).
 *
 * One client per app: a second call — Fast Refresh running the setup module again — returns an
 * integration over the first one and ignores its options, rather than installing the error
 * handlers twice.
 */
export function posthogAnalytics(options: {
  token: `phc_${string}`;
  config: PostHogOptions & { host: string };
  /**
   * PostHog's error tracking. `true` or options turn on exception autocapture and filter what is
   * sent (`ignoreErrors`); `false` sends no exception at all, autocaptured or reported
   * (`capturePosthogException`, `PosthogErrorBoundary`) — for development,
   * which would otherwise fill the production project's issues. Left out, the library's own
   * `config.errorTracking` decides (autocapture off by default).
   */
  errorTracking?: boolean | PosthogErrorTrackingOptions;
}): Integration {
  const { token, errorTracking } = options;
  let config: PostHogOptions = options.config;
  if (errorTracking !== undefined) {
    const tracking = typeof errorTracking === 'object' ? errorTracking : {};
    config = {
      ...config,
      errorTracking: {
        ...config.errorTracking,
        autocapture:
          config.errorTracking?.autocapture ?? (errorTracking && (tracking.autocapture ?? true)),
      },
      // First, so the host's own hooks never see an exception that is not sent.
      before_send: [
        exceptionFilter(!errorTracking, tracking.ignoreErrors ?? []),
        ...[config.before_send ?? []].flat(),
      ],
    };
  }
  client ??= new PostHog(token, config);
  return {
    type: 'analytics',
    track: sendPosthogEvent,
    setUser: setPosthogUser,
  };
}
