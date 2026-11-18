import type { CaptureResult, Properties } from '@posthog/types';
import {
  Component,
  type ErrorInfo,
  type FunctionComponent,
  type ReactNode,
  isValidElement,
} from 'react';

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
 * What the web and React Native `PosthogErrorBoundary` share — the state, the fallback, the reset —
 * leaving how an error reaches PostHog to `capture`. It imports no PostHog code, so neither
 * platform's boundary brings the other's library (or the web snippet) into its bundle.
 *
 * It never throws: a failure to report (no PostHog, a throwing `additionalProperties`, a throwing
 * `capture`) is logged and the fallback still renders.
 */
export abstract class PosthogErrorBoundaryBase extends Component<PosthogErrorBoundaryProps, State> {
  override state = INITIAL_STATE;

  /** Sends the error to PostHog; may throw, which `componentDidCatch` catches. */
  protected abstract capture(
    error: unknown,
    componentStack: string,
    properties: Properties | undefined
  ): CaptureResult | undefined;

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
      exceptionEvent = this.capture(error, componentStack, properties);
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
