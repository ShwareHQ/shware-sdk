import type { JourneyReporting } from '../store';
import { BURST_WINDOW_MS, classifyClick, classifyOpen } from './classify';

/**
 * The endpoints a journey email's tracking points at (see ./observer.ts), served by journeyWorker
 * without a bearer — recipients open them:
 *
 *   GET /t/o/<message>             the open pixel: records the open, answers a 1×1 GIF
 *   GET /t/l/<message>/<position>  a link: records the click, redirects to the recorded URL
 *   GET /t/u/<message>/<position>  the unsubscribe link: records the click, asks to confirm
 *   GET  /t/u/<message>            the List-Unsubscribe header's URL, opened: asks to confirm
 *   POST /t/u/<message>            the unsubscribe confirmation, and the header's one-click
 *                                  unsubscribe (RFC 8058: a mail client's button posts here)
 *   POST /t/d/<message>            a push the device received (iOS's notification service
 *                                  extension, a browser's service worker)
 *   POST /t/p/<message>            a push opened, reported by a browser's service worker
 *
 * Every open and click is recorded with its verdict (./classify.ts), and the message keeps its
 * first open and click of each kind. The redirect goes only to the URL recorded for that position,
 * never to one the request carries, so the endpoint cannot bounce visitors anywhere else. An
 * email's unsubscribe link is a tracked link too, and which link it is was fixed when the email was
 * sent (its route): following it shows a confirmation page, and only the confirmation — a POST,
 * which no link scanner sends — counts. Changing a template's or the config's unsubscribe URL, or
 * removing the template, changes nothing for emails already sent.
 */

export interface TrackingOptions {
  /** The name the confirmation pages show (the config's `title`). */
  product?: string | undefined;
  /** `email.tracking.quickClickMs`: how soon after delivery an open or click is a weak machine signal. */
  quickMs?: number | undefined;
  /** A browser reported a push tapped (`/t/p`): the host records it as an event too (`webPush.openedEvent`). */
  pushOpened?:
    | ((open: { messageId: string; userId: string; at: number }) => Promise<void>)
    | undefined;
  /**
   * An unsubscribe was recorded (`POST /t/u`): the host wakes the user's waits that read email
   * reachability, so an `exitWhen: not(reachable('email'))` takes effect at once. Its failure is
   * logged, never a reason to fail the unsubscribe.
   */
  onUnsubscribed?:
    | ((unsubscribe: { messageId: string; userId: string; at: number }) => Promise<void>)
    | undefined;
}

const GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (char) => char.charCodeAt(0)
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Requester {
  method: string;
  userAgent: string | null;
  asn: number | null;
  organization: string | null;
  country: string | null;
}

function requester(request: Request): Requester {
  const cf = (
    request as Request & { cf?: { asn?: number; asOrganization?: string; country?: string } }
  ).cf;
  return {
    method: request.method,
    userAgent: request.headers.get('user-agent'),
    asn: cf?.asn ?? null,
    organization: cf?.asOrganization ?? null,
    country: cf?.country ?? null,
  };
}

/** A `/t/...` request's response, or undefined when the path is not a tracking route. */
export async function handleTracking(
  request: Request,
  reporting: JourneyReporting,
  options: TrackingOptions = {}
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname.split('/');
  const root = path.at(1);
  const kind = path.at(2);
  const id = path.at(3);
  const position = path.at(4);
  if (root !== 't' || id === undefined || !UUID.test(id)) return undefined;
  const who = requester(request);
  const read = who.method === 'GET' || who.method === 'HEAD';
  if (kind === 'o' && read) {
    await recordOpen(reporting, id, who, options);
    return new Response(who.method === 'HEAD' ? null : GIF, {
      headers: { 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0' },
    });
  }
  if ((kind === 'l' || kind === 'u') && position !== undefined && read) {
    const target = await recordClick(reporting, id, Number(position), who, options);
    if (target === undefined) return page(options, 'This link has expired.', 404);
    if (kind === 'u') return confirmUnsubscribe(options, id);
    return Response.redirect(target, 302);
  }
  // The List-Unsubscribe URL opened in a browser (a client without one-click): the same question
  if (kind === 'u' && position === undefined && read) return confirmUnsubscribe(options, id);
  if (kind === 'd' && who.method === 'POST') {
    const known = await reporting.recordDeviceDelivered(id, Date.now());
    return new Response(null, { status: known ? 204 : 404 });
  }
  if (kind === 'p' && who.method === 'POST') {
    // A notification tap: a person, as the message id is what proves it is theirs
    const at = Date.now();
    let userId: string | undefined;
    const known = await reporting.recordOpen(id, (message) => {
      userId = message.userId;
      return { at, machine: false, reason: null, ...network(who) };
    });
    if (known && userId !== undefined && options.pushOpened !== undefined) {
      try {
        await options.pushOpened({ messageId: id, userId, at });
      } catch (error) {
        // The open is recorded; the event is the host's extra, never a reason to fail the beacon
        console.error(`[workflow] recording push open ${id} as an event failed`, error);
      }
    }
    return new Response(null, { status: known ? 204 : 404 });
  }
  if (kind === 'u' && who.method === 'POST') {
    const at = Date.now();
    const unsubscribed = await reporting.recordUnsubscribe(id, at);
    // A mail client's one-click POST must succeed: for a copy no longer on record (its user
    // erased) there is nothing left to send to, so the answer is the same
    if (unsubscribed === undefined) return page(options, "You won't get these emails anymore.");
    if (options.onUnsubscribed !== undefined) {
      try {
        await options.onUnsubscribed({ messageId: id, userId: unsubscribed.userId, at });
      } catch (error) {
        console.error(`[workflow] acting on the unsubscribe of ${id} failed`, error);
      }
    }
    return page(
      options,
      options.product === undefined
        ? "You won't get these emails anymore."
        : `You won't get these emails from ${escape(options.product)} anymore.`
    );
  }
  return undefined;
}

/** The question an unsubscribe link, or the List-Unsubscribe URL opened in a browser, asks. */
function confirmUnsubscribe(options: TrackingOptions, id: string): Response {
  return page(
    options,
    `Unsubscribe from ${escape(options.product ?? 'these')} emails?`,
    200,
    `<form method="post" action="/t/u/${id}"><button type="submit">Unsubscribe</button></form>`
  );
}

/**
 * A journey push tapped open, as the app reports it (`JourneyClient.messageOpened`): an open on
 * the copy — only the recipient's own, and never a machine, since no proxy or scanner taps a
 * notification. False when the message is unknown or not the user's.
 */
export async function recordPushOpen(
  reporting: JourneyReporting,
  userId: string,
  messageId: string,
  at = Date.now()
): Promise<boolean> {
  if (!UUID.test(messageId)) return false;
  let recorded = false;
  await reporting.recordOpen(messageId, (message) => {
    if (message.userId !== userId) return undefined;
    recorded = true;
    return {
      at,
      machine: false,
      reason: null,
      userAgent: null,
      asn: null,
      organization: null,
      country: null,
    };
  });
  return recorded;
}

async function recordOpen(
  reporting: JourneyReporting,
  id: string,
  who: Requester,
  options: TrackingOptions
) {
  const at = Date.now();
  await reporting.recordOpen(id, (message) => ({
    at,
    ...classifyOpen(
      { ...who, sinceDeliveredMs: at - message.deliveredAt },
      { quickMs: options.quickMs }
    ),
    ...network(who),
  }));
}

const network = (who: Requester) => ({
  userAgent: who.userAgent,
  asn: who.asn,
  organization: who.organization,
  country: who.country,
});

/** Records the click and answers the URL to send the visitor to, or undefined for an unknown link. */
async function recordClick(
  reporting: JourneyReporting,
  id: string,
  position: number,
  who: Requester,
  options: TrackingOptions
): Promise<string | undefined> {
  if (!Number.isInteger(position) || position < 0) return undefined;
  const at = Date.now();
  const recorded = await reporting.recordClick(id, position, at, BURST_WINDOW_MS, (link) => {
    const linksInBurst = new Set([position, ...link.recent.map((click) => click.position)]).size;
    const verdict = classifyClick(
      { ...who, sinceDeliveredMs: at - link.deliveredAt, linksInBurst, linkCount: link.linkCount },
      { quickMs: options.quickMs }
    );
    return {
      engagement: { at, ...verdict, ...network(who) },
      backdate: verdict.reason === 'link_burst' || verdict.reason === 'quick+link_pair',
    };
  });
  return recorded?.url;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(options: TrackingOptions, message: string, status = 200, extra = ''): Response {
  const title = escape(options.product ?? 'Email');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#fafafa;color:#18181b}main{text-align:center;padding:24px}button{font:inherit;padding:10px 20px;border-radius:9999px;border:0;background:#18181b;color:#fff;cursor:pointer}</style></head><body><main><p>${message}</p>${extra}</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
