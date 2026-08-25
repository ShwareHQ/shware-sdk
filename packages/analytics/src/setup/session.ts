import { v7 as uuidv7 } from 'uuid';

export const SESSION_TIMEOUT = 30 * 60 * 1000;

class Session {
  private id: string;
  private startTime: number;
  private lastActiveTime: number;
  private accumulatedTime: number;

  private active: boolean;
  private visible: boolean;
  private focused: boolean;

  constructor() {
    this.id = uuidv7();
    this.startTime = Date.now();
    this.lastActiveTime = Date.now();
    this.accumulatedTime = 0;

    this.active = true;
    this.visible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    this.focused = typeof document !== 'undefined' ? document.hasFocus() : true;
  }

  getId = () => this.id;

  isActive = () => this.active;
  isVisible = () => this.visible;
  isFocused = () => this.focused;
  isExpired = () => Date.now() - this.lastActiveTime > SESSION_TIMEOUT;

  updateLastActiveTime = () => {
    this.lastActiveTime = Date.now();
  };

  updateActive = (active: boolean) => {
    this.active = active;
  };

  refresh = () => {
    this.id = uuidv7();
    this.lastActiveTime = Date.now();
  };

  updateAccumulator = () => {
    const now = Date.now();
    if (this.focused && this.visible && this.active) {
      const delta = now - this.startTime;
      if (delta > 0 && delta < SESSION_TIMEOUT) {
        this.accumulatedTime += delta;
      }
    }
    this.startTime = now;
  };

  focus = () => {
    this.updateAccumulator();
    this.updateLastActiveTime();
    this.focused = true;
  };

  blur = () => {
    this.updateAccumulator();
    this.focused = false;
  };

  pageshow = () => {
    this.updateAccumulator();
    this.updateLastActiveTime();
    this.active = true;
  };

  pagehide = () => {
    this.updateAccumulator();
    this.active = false;
  };

  visibilitychange = (state: DocumentVisibilityState) => {
    this.updateAccumulator();
    if (state === 'visible') {
      this.updateLastActiveTime();
    }
    this.visible = state === 'visible';
  };

  flush = () => {
    this.updateAccumulator();
    const engagementTime = this.accumulatedTime;
    this.accumulatedTime = 0;
    return engagementTime;
  };
}

let session: Session | undefined;

/**
 * The session, built the first time something asks for it.
 *
 * Deliberately not a module-scope `new Session()`. The constructor calls
 * `uuidv7()`, `uuid` draws its bytes from `crypto.getRandomValues`, and
 * Cloudflare Workers reject that outside a request handler:
 *
 *   Disallowed operation called within global scope. Asynchronous I/O
 *   (ex: fetch() or connect()), setting a timeout, and generating random
 *   values are not allowed within global scope.
 *
 * Module scope in a Worker is evaluated once when the isolate boots and is
 * then shared by every request that isolate serves, so a random value drawn
 * there would be the same for all of them — which is why the runtime refuses
 * to produce one. A host that server-renders on Workers reaches this module
 * through `track()` on the server as well, and the throw happened as the
 * isolate booted, taking down every route before a component rendered.
 *
 * Everything here is per-visitor browser or app state, so deferring the
 * construction costs nothing and buys two things: the server bundle can be
 * evaluated, and `startTime` marks when the session actually began rather
 * than when the isolate happened to start.
 */
export function getSession() {
  return (session ??= new Session());
}
