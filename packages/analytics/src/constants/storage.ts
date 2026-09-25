export const keys = {
  device_id: 'device_id',
  visitor_id: 'visitor_id',
  first_open_time: 'first_open_time',
  first_visit_time: 'first_visit_time',
  /** Native: when a launch took the install referrer's utm as its own (see native `getTags`). */
  install_referrer_claimed_at: 'install_referrer_claimed_at',
  session: 'session',
} as const;
