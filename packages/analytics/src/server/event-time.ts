/**
 * When an event happened, as a conversions API is told: its stored time, but never later than
 * now. Microsoft, Reddit and Meta reject an event stamped in the future, and fail the whole
 * request with it; a browser clock running a few minutes fast stamps exactly that, and an event
 * cannot have happened after the moment it is sent.
 */
export function eventTimeMs(createdAt: string): number {
  return Math.min(Date.parse(createdAt), Date.now());
}
