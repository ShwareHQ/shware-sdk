import type { CaptureResult, Properties } from 'posthog-js';
import {
  Component,
  type ErrorInfo,
  type FunctionComponent,
  type ReactNode,
  isValidElement,
} from 'react';
import { getPosthog } from '../third-parties/posthog';

export interface PosthogErrorBoundaryFallbackProps {
  error: unknown;
  /** The `$exception` event sent; `undefined` while only the stub is there, which queues it. */
  exceptionEvent: CaptureResult | undefined;
  componentStack: string;
  resetError: () => void;
}

export interface PosthogErrorBoundaryProps {
  children?: ReactNode | (() => ReactNode);
  fallback?: ReactNode | FunctionComponent<PosthogErrorBoundaryFallbackProps>;
  additionalProperties?: Properties | ((error: unknown, errorInfo: ErrorInfo) => Properties);
}

interface State {
  error: unknown;
  componentStack: string | null;
  exceptionEvent: CaptureResult | undefined;
}

const INITIAL_STATE: State = { error: null, componentStack: null, exceptionEvent: undefined };

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
export class PosthogErrorBoundary extends Component<PosthogErrorBoundaryProps, State> {
  override state = INITIAL_STATE;

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    const componentStack = errorInfo.componentStack ?? '';
    let exceptionEvent: CaptureResult | undefined;
    // Reporting must never fail the boundary: an error thrown here would go to the boundary
    // above it, if any — `additionalProperties` throwing, or an error that cannot take a cause.
    try {
      const { additionalProperties } = this.props;
      const properties =
        typeof additionalProperties === 'function'
          ? additionalProperties(error, errorInfo)
          : additionalProperties;
      exceptionEvent = getPosthog()?.captureException(
        withComponentStack(error, componentStack),
        properties
      );
    } catch (e: unknown) {
      console.error('PosthogErrorBoundary: the error was not reported', e);
    }
    this.setState({ error, componentStack, exceptionEvent });
  }

  resetError = () => {
    this.setState(INITIAL_STATE);
  };

  override render() {
    const { children, fallback } = this.props;
    const { error, componentStack, exceptionEvent } = this.state;
    if (componentStack === null) return typeof children === 'function' ? children() : children;

    const element =
      typeof fallback === 'function'
        ? fallback({ error, componentStack, exceptionEvent, resetError: this.resetError })
        : fallback;
    if (isValidElement(element)) return element;
    console.warn('PosthogErrorBoundary: fallback is not a React element; rendering nothing');
    return null;
  }
}

/**
 * `posthog-js/react`'s `setupReactErrorHandler`, for the snippet-loaded library, so without its
 * `client`: a handler for React 19's root options, which report what no `PosthogErrorBoundary`
 * sees — `onUncaughtError` (no boundary caught it), `onCaughtError` (a framework's boundary did,
 * e.g. TanStack Router's `errorComponent`) and `onRecoverableError` (a hydration mismatch React
 * recovered from). The error goes to PostHog with its component stack; `callback` gets the event
 * (`undefined` while only the stub is there), as React's own logging does not run once a handler
 * is set.
 *
 * ```tsx
 * hydrateRoot(document, <StartClient />, {
 *   onUncaughtError: setupReactErrorHandler(),
 *   onCaughtError: setupReactErrorHandler(),
 *   onRecoverableError: setupReactErrorHandler(),
 * });
 * ```
 *
 * Never throws, as `PosthogErrorBoundary`: a failure to report is logged.
 */
export function setupReactErrorHandler(
  callback?: (event: CaptureResult | undefined, error: unknown, errorInfo: ErrorInfo) => void
): (error: unknown, errorInfo: ErrorInfo) => void {
  return (error, errorInfo) => {
    let event: CaptureResult | undefined;
    try {
      event = getPosthog()?.captureException(withComponentStack(error, errorInfo.componentStack));
    } catch (e: unknown) {
      console.error('setupReactErrorHandler: the error was not reported', e);
    }
    callback?.(event, error, errorInfo);
  };
}
