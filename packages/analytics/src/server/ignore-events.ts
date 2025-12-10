const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];
const session = [
  'first_visit',
  'page_view',
  'screen_view',
  'session_start',
  'scroll',
  'user_engagement', // when page hide, visibility hidden
];
const notification = [
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'notification_send',
];

export const IGNORE_EVENTS = [...metrics, ...session, ...notification];
