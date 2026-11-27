import type { JourneyObserver, MessageTracking, OutboundMessage } from '../engine';
import type { JourneyReporting, TrackedLink } from '../store';

/**
 * The observer journeyWorker installs when the store keeps reporting: every node arrival, copy
 * and outcome recorded through `store.reporting`.
 *
 * A copy is recorded before it goes out, so its id can travel with it: with a tracking origin,
 * an email's links become `<origin>/t/l/<message>/<position>` — `/t/u/...` for its unsubscribe
 * link, so what a click means is fixed when it is sent — and an open pixel `<origin>/t/o/<message>`
 * (served by the Worker, ./tracking.ts); the renderer gets the id too, for the email's
 * preferences link (`email.preferencesUrl?m=<message>`), and a push carries
 * `message_id` in its payload for the app to report the tap (`JourneyClient.messageOpened`),
 * plus `delivered_url` / `opened_url` for a client that reports straight to the Worker.
 * The links are recorded when the sender commits the rewritten email, before it goes out.
 */
export function reportingObserver(
  reporting: JourneyReporting,
  origin: string | undefined
): JourneyObserver {
  const base = origin?.replace(/\/$/, '');

  return {
    started: (event) => reporting.instanceStarted(event),

    nodeReached: (event) => reporting.nodeReached(event),

    messageSettled: (message) => reporting.messageSettled(message.idempotencyKey),

    messageClaimed: (message) => reporting.claimMessage(message.idempotencyKey, Date.now()),

    messageReleased: (message) => reporting.releaseMessage(message.idempotencyKey),

    async messagePrepared(message) {
      const id = await reporting.recordMessage({
        idempotencyKey: message.idempotencyKey,
        workflow: message.workflow,
        instanceId: message.instanceId,
        nodeId: message.nodeId,
        template: message.template,
        channel: channelOf(message),
        userId: message.userId,
        topic:
          message.channel === 'email' || message.channel === 'push'
            ? (message.topic ?? null)
            : null,
        sentAt: Date.now(),
      });
      if (message.channel === 'email' && base !== undefined) {
        const links: TrackedLink[] = [];
        return {
          messageId: id,
          link: (url, purpose) => {
            links.push({ url, purpose });
            return `${base}/t/${purpose === 'unsubscribe' ? 'u' : 'l'}/${id}/${links.length - 1}`;
          },
          pixel: `${base}/t/o/${id}`,
          unsubscribe: `${base}/t/u/${id}`,
          // Before the transport takes it, so no click can reach a link not yet recorded
          commit: () => reporting.recordLinks(id, links),
        };
      }
      if (message.channel === 'push') {
        // The app reports the tap with `message_id`; a client that can reach the Worker on its
        // own (iOS's notification service extension, a browser's service worker) posts to these
        return {
          data: {
            message_id: id,
            ...(base === undefined
              ? {}
              : { delivered_url: `${base}/t/d/${id}`, opened_url: `${base}/t/p/${id}` }),
          },
        };
      }
      return undefined;
    },

    async messageSent(message, result) {
      await reporting.settleMessage(message.idempotencyKey, result, Date.now());
    },

    finished: (event) => reporting.instanceFinished(event),
  };
}

/** Where the copy lands — the Studio's metric channel: a push is reported per platform. */
function channelOf(message: OutboundMessage): string {
  if (message.channel !== 'push') return message.channel;
  return `push_${message.device?.platform ?? 'unknown'}`;
}

/**
 * Whether the observer keeps the delivery record itself: it implements one of the three hooks
 * that decide if a copy reaches the transport (see `JourneyObserver`).
 */
export function decidesDelivery(observer: JourneyObserver): boolean {
  return (
    observer.messageSettled !== undefined ||
    observer.messageClaimed !== undefined ||
    observer.messageReleased !== undefined
  );
}

/**
 * `extra`'s hooks added to `base`'s: every report reaches both, `base` first. `base` keeps the
 * delivery record — at-most-once delivery is its claim, which a host adding a hook of its own
 * must not lose — so `extra` is one that does not decide delivery (`decidesDelivery`). The
 * tracking `extra` prepares is laid over `base`'s: its fields win, the push `data` of both is
 * sent, and both commits run before the transport takes the copy.
 */
export function composeObservers(base: JourneyObserver, extra: JourneyObserver): JourneyObserver {
  return {
    async started(event) {
      await base.started?.(event);
      await extra.started?.(event);
    },
    async nodeReached(event) {
      await base.nodeReached?.(event);
      await extra.nodeReached?.(event);
    },
    messageSettled: async (message) => (await base.messageSettled?.(message)) ?? false,
    async messagePrepared(message) {
      const prepared = await base.messagePrepared?.(message);
      return mergeTracking(prepared, await extra.messagePrepared?.(message));
    },
    messageClaimed: async (message) => (await base.messageClaimed?.(message)) ?? true,
    messageReleased: async (message) => base.messageReleased?.(message),
    async messageSent(message, result) {
      // The settle first: a report of the host's own that throws must not leave the copy claimed
      // and unsettled, which a replay reads as possibly delivered
      await base.messageSent?.(message, result);
      await extra.messageSent?.(message, result);
    },
    async finished(event) {
      await base.finished?.(event);
      await extra.finished?.(event);
    },
  };
}

function mergeTracking(
  base: MessageTracking | undefined,
  extra: MessageTracking | undefined
): MessageTracking | undefined {
  if (base === undefined || extra === undefined) return base ?? extra;
  const merged: MessageTracking = { ...base };
  for (const key of ['messageId', 'link', 'pixel', 'unsubscribe'] as const) {
    if (extra[key] !== undefined) Object.assign(merged, { [key]: extra[key] });
  }
  if (extra.data !== undefined) merged.data = { ...base.data, ...extra.data };
  const first = base.commit;
  const second = extra.commit;
  if (first !== undefined && second !== undefined) {
    merged.commit = async () => {
      await first();
      await second();
    };
  } else if (second !== undefined) {
    merged.commit = second;
  }
  return merged;
}
