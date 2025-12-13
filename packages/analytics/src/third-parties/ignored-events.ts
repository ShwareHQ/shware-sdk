/**
 * Automatically collected events: https://support.google.com/analytics/answer/9234069
 * Enhanced measurement events: https://support.google.com/analytics/answer/9216061
 */
const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];
const session = [
  'first_visit',
  'first_open',
  'page_view',
  'screen_view',
  'session_start',
  'scroll',
  'user_engagement', // when page hide, visibility hidden
];
const outboundClicks = ['click'];
const siteSearch = ['view_search_results'];
const videoEngagement = ['video_start', 'video_progress', 'video_complete'];
const fileDownloads = ['file_download'];
const formInteractions = ['form_start', 'form_submit'];
const notification = [
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'notification_send',
];

export const IGNORED_EVENTS = [
  ...metrics,
  ...session,
  ...outboundClicks,
  ...siteSearch,
  ...videoEngagement,
  ...fileDownloads,
  ...formInteractions,
  ...notification,
];
