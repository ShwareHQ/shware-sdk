import { v7 as uuidv7 } from 'uuid';
import { keys } from '../constants/storage';
import { config } from './index';

export const SESSION_TIMEOUT = 30 * 60 * 1000;

/**
 * The part of a session that outlives the page: its identity, and the clock the timeout is
 * measured against. GA4 keeps these in its `_ga_<container>` cookie — alongside the engaged flag,
 * which arrives with `session_engaged` later — and rereads them for every event, which is what
 * makes a session survive a reload, span a whole multipage visit, and stay shared between two
 * tabs of the same site. Holding them in memory instead, as this did, starts a new session on
 * every full navigation and gives every tab one of its own.
 */
interface StoredSession {
  id: string;
  /** When the last event was sent. The timeout is measured from here, and only from here. */
  lastEventTime: number;
}

/** The session an event belongs to, and whether that event is the one that started it. */
interface SessionForEvent {
  id: string;
  started: boolean;
}

/**
 * `<version>.<id>.<lastEventTime>`, compact and cookie-safe rather than JSON: `{`, `"`
 * and `,` all have to be percent-encoded in a cookie, and a host that wants one session across
 * its subdomains will hand `setupAnalytics` a cookie-backed `storage`, where this has to survive
 * unchanged. A uuidv7 contains no dots, so the record splits cleanly.
 *
 * The version guards a change the parser could not otherwise survive. A field appended to the end
 * does not need one — a short record simply leaves it undefined.
 */
const VERSION = '1';

function readSession(): StoredSession | undefined {
  const raw = config.storage.getItem(keys.session);
  if (!raw) return undefined;

  const [version, id, lastEventTime] = raw.split('.');
  if (version !== VERSION || !id) return undefined;

  const parsed = { id, lastEventTime: Number(lastEventTime) };
  if (!Number.isFinite(parsed.lastEventTime)) return undefined;
  return parsed;
}

function writeSession({ id, lastEventTime }: StoredSession) {
  config.storage.setItem(keys.session, `${VERSION}.${id}.${lastEventTime}`);
}

class Session {
  /**
   * Engagement is deliberately not stored: it is the time this page has accrued and not yet
   * reported, so it belongs to the page, not to the session. GA4 draws the same line — its cookie
   * carries the session, while the engagement timer lives and dies with the document.
   *
   * `lastTickTime` is where the accumulator last settled up, rewritten on every tick — it is not
   * when the session began, and nothing here needs to know that.
   */
  private lastTickTime: number;
  private accumulatedTime: number;

  private active: boolean;
  private visible: boolean;
  private focused: boolean;

  constructor() {
    this.lastTickTime = Date.now();
    this.accumulatedTime = 0;

    this.active = true;
    this.visible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    this.focused = typeof document !== 'undefined' ? document.hasFocus() : true;
  }

  /**
   * The session a batch of events belongs to: read the stored one, start a new one if it has
   * timed out or there is none, stamp it with when those events happened and write it back. Every
   * event goes through here, exactly as GA4 rereads and rewrites its cookie per event — caching
   * the session in memory would put the tabs back out of step with each other.
   */
  touch = (eventTime: number, lastEventTime = eventTime): SessionForEvent => {
    const stored = readSession();

    if (stored && eventTime - stored.lastEventTime <= SESSION_TIMEOUT) {
      // `Math.max`, because a batch that waited in a frozen tab can be older than what another
      // tab has since written, and a session must never be shortened by a late arrival.
      writeSession({ ...stored, lastEventTime: Math.max(stored.lastEventTime, lastEventTime) });
      return { id: stored.id, started: false };
    }

    // Engagement the previous session accrued but never reported dies with it rather than being
    // handed to its successor. GA4 does the same on `session_start`.
    this.accumulatedTime = 0;
    // Wall clock, not `eventTime`: this anchors the engagement timer for the page in front of the
    // visitor now, which a batch describing something that happened an hour ago says nothing about.
    this.lastTickTime = Date.now();

    const session: StoredSession = { id: uuidv7(), lastEventTime };
    writeSession(session);
    return { id: session.id, started: true };
  };

  /**
   * The id for an event that must not start a session — the `pagehide` beacon, which reports what
   * the session now ending accrued. A live session is extended, as any event extends it; one
   * already past its timeout still owns that engagement, so its id comes back without being
   * revived into a session no `session_start` ever announced.
   */
  extend = (): string => {
    const stored = readSession();
    if (!stored) return this.touch(Date.now()).id;

    const now = Date.now();
    if (now - stored.lastEventTime <= SESSION_TIMEOUT) {
      writeSession({ ...stored, lastEventTime: now });
    }
    return stored.id;
  };

  isActive = () => this.active;

  updateActive = (active: boolean) => {
    this.active = active;
  };

  updateAccumulator = () => {
    const now = Date.now();
    if (this.focused && this.visible && this.active) {
      const delta = now - this.lastTickTime;
      if (delta > 0 && delta < SESSION_TIMEOUT) {
        this.accumulatedTime += delta;
      }
    }
    this.lastTickTime = now;
  };

  focus = () => {
    this.updateAccumulator();
    this.focused = true;
  };

  blur = () => {
    this.updateAccumulator();
    this.focused = false;
  };

  pageshow = () => {
    this.updateAccumulator();
    this.active = true;
  };

  pagehide = () => {
    this.updateAccumulator();
    this.active = false;
  };

  visibilitychange = (state: DocumentVisibilityState) => {
    this.updateAccumulator();
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
 * construction costs nothing and lets the server bundle be evaluated. It does
 * not make any of it safe to use there: this instance, `cache` and `config` are
 * module singletons, so calling `track()` on a server shares one session and one
 * visitor across every request the isolate serves. Import it there; do not track.
 */
export function getSession() {
  return (session ??= new Session());
}
