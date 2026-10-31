export const keys = {
  device_id: 'device_id',
  visitor_id: 'visitor_id',
  first_open_time: 'first_open_time',
  first_visit_time: 'first_visit_time',
  /** Native: when a launch took the install referrer's utm as its own (see native `getTags`). */
  install_referrer_claim_time: 'install_referrer_claim_time',
  session: 'session',
  /**
   * The user `identify` last identified on this device, cleared by `reset()`: a different user
   * signing in over it (an expired session, a sign-out the host never reported) resets first,
   * rather than carrying the previous user's visitor over to the next.
   */
  user_id: 'user_id',
} as const;
