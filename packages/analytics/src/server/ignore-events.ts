const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];
const session = ['session_start', 'session_end', 'page_view', 'screen_view'];
const notification = [
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'notification_send',
];

export const IGNORE_EVENTS = [...metrics, ...session, ...notification];
