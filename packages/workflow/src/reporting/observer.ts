import type { JourneyObserver, OutboundMessage } from '../engine';
import type { JourneyReporting } from '../store';

/**
 * The observer journeyWorker installs when the store keeps reporting: every node arrival, copy
 * and outcome recorded through `store.reporting`.
 *
 * A copy is recorded before it goes out, so its id can travel with it: with a tracking origin,
 * an email's links become `<origin>/t/l/<message>/<position>` — `/t/u/...` for its unsubscribe
 * link, so what a click means is fixed when it is sent — and an open pixel `<origin>/t/o/<message>`
 * (served by the Worker, ./tracking.ts), and a push carries
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

    async messagePrepared(message) {
      const id = await reporting.recordMessage({
        idempotencyKey: message.idempotencyKey,
        workflow: message.workflow,
        instanceId: message.instanceId,
        nodeId: message.nodeId,
        template: message.template,
        channel: channelOf(message),
        userId: message.userId,
        topic: message.channel === 'email' ? (message.topic ?? null) : null,
        sentAt: Date.now(),
      });
      if (message.channel === 'email' && base !== undefined) {
        const urls: string[] = [];
        return {
          link: (url, purpose) => {
            urls.push(url);
            return `${base}/t/${purpose === 'unsubscribe' ? 'u' : 'l'}/${id}/${urls.length - 1}`;
          },
          pixel: `${base}/t/o/${id}`,
          unsubscribe: `${base}/t/u/${id}`,
          // Before the transport takes it, so no click can reach a link not yet recorded
          commit: () => reporting.recordLinks(id, urls),
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
