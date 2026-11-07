/**
 * Who the engine's rows are about: a user, or a visitor not signed in yet. A visitor is a user
 * with a reserved id, so journeys, events, profiles and opt-outs work the same for both; signing
 * in moves the visitor's rows to the user (`linkVisitor`). Callers never see the prefix: they
 * pass `userId` and `visitorId` as two fields.
 */
const VISITOR_PREFIX = 'visitor:';

export function visitorSubject(visitorId: string): string {
  return `${VISITOR_PREFIX}${visitorId}`;
}

export function isVisitorSubject(subject: string): boolean {
  return subject.startsWith(VISITOR_PREFIX);
}

/** The visitor id inside a subject; undefined for a user. */
export function visitorIdOf(subject: string): string | undefined {
  return isVisitorSubject(subject) ? subject.slice(VISITOR_PREFIX.length) : undefined;
}

/**
 * Who an instance belongs to now. A journey a visitor started moves to the user when they sign in,
 * with its entry: read per use, because a wait can outlast the sign-in. An instance a user started
 * never moves, so it costs no read.
 */
export async function instanceOwner(
  store: { entryOwner(instanceId: string): Promise<string | undefined> },
  instanceId: string,
  startedAs: string
): Promise<string> {
  if (!isVisitorSubject(startedAs)) return startedAs;
  return (await store.entryOwner(instanceId)) ?? startedAs;
}
