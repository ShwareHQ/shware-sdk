import type { CaptureResult, Properties } from '@posthog/types';
import type { ErrorInfo } from 'react';
import { getPosthog } from '../third-parties/posthog';
import { PosthogErrorBoundaryBase } from './error-boundary';

export type {
  PosthogErrorBoundaryFallbackProps,
  PosthogErrorBoundaryProps,
} from './error-boundary';

/**
 * The error as PostHog's own boundary reports it: the React component stack added as a cause, so
 * the issue shows which components it was thrown in.
 */
function withComponentStack(error: unknown, componentStack: string | null | undefined): unknown {
  if (!componentStack) return error;
  const isError = error instanceof Error;
  const stackError = new Error(
    isError ? error.message : `Primitive value captured as exception: ${String(error)}`
  );
  stackError.name = `React ErrorBoundary ${isError ? error.name : 'Error'}`;
  stackError.stack = componentStack;
  if (!isError) return stackError;
  // At the end of the error's cause chain, keeping a last cause that is not an error under it.
  const seen = new WeakSet<Error>();
  let current = error;
  while (!seen.has(current)) {
    seen.add(current);
    if (!(current.cause instanceof Error)) {
      if (current.cause !== undefined) stackError.cause = current.cause;
      current.cause = stackError;
      break;
    }
    current = current.cause;
  }
  return error;
}

/**
 * `posthog-js/react`'s `PostHogErrorBoundary`, with its props, for the snippet-loaded library: a
 * render error in `children` is sent to PostHog's error tracking (`captureException`, as an
 * `$exception` event tied to the session's replay) and `fallback` renders instead — a
 * component gets the error and `resetError`. An error thrown before the library has loaded is
 * queued on the stub and sent once it has.
 *
 * The boundary itself never throws: a failure to report (no PostHog, an ad blocker that stopped the
 * library, a throwing `additionalProperties`) is logged and the fallback still renders. It
 * catches render errors only, as any error boundary; errors outside React's render (event
 * handlers, unhandled rejections) are the library's exception autocapture's, enabled in the
 * snippet's `config` (`capture_exceptions`).
 */
export class PosthogErrorBoundary extends PosthogErrorBoundaryBase {
  /** As `posthog-js/react`'s boundary: the component stack as the error's cause. */
  protected override capture(
    error: unknown,
    componentStack: string,
    properties: Properties | undefined
  ): CaptureResult | undefined {
    return getPosthog()?.captureException(withComponentStack(error, componentStack), properties);
  }
}

/**
 * `posthog-js/react`'s `setupReactErrorHandler`, for the snippet-loaded library, so without its
 * `client`: a handler for React 19's root options, which report what no `PosthogErrorBoundary`
 * sees — `onUncaughtError` (no boundary caught it), `onCaughtError` (a framework's boundary did,
 * e.g. TanStack Router's `errorComponent`) and `onRecoverableError` (a hydration mismatch React
 * recovered from). The error goes to PostHog with its component stack and is logged with
 * `console.error`, as React's own logging does not run once a handler is set; a `callback` gets the
 * event (`undefined` while only the stub is there) instead of that logging.
 *
 * ```tsx
 * hydrateRoot(document, <StartClient />, {
 *   onUncaughtError: setupPosthogReactErrorHandler(),
 *   onCaughtError: setupPosthogReactErrorHandler(),
 *   onRecoverableError: setupPosthogReactErrorHandler(),
 * });
 * ```
 *
 * Never throws, as `PosthogErrorBoundary`: a failure to report is logged.
 */
export function setupPosthogReactErrorHandler(
  callback?: (event: CaptureResult | undefined, error: unknown, errorInfo: ErrorInfo) => void
): (error: unknown, errorInfo: ErrorInfo) => void {
  return (error, errorInfo) => {
    let event: CaptureResult | undefined;
    try {
      event = getPosthog()?.captureException(withComponentStack(error, errorInfo.componentStack));
    } catch (e: unknown) {
      console.error('setupPosthogReactErrorHandler: the error was not reported', e);
    }
    if (callback) callback(event, error, errorInfo);
    // React logs these itself only while no handler is set; keep them in the console. Not
    // `reportError`, React's own default for uncaught errors: it dispatches a window `error`,
    // which the library's exception autocapture would send a second time.
    else console.error(error);
  };
}
