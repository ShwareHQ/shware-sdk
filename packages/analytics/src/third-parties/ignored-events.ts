const METRICS_EVENTS = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];

/**
 * Automatically collected events: https://support.google.com/analytics/answer/9234069
 * Enhanced measurement events: https://support.google.com/analytics/answer/9216061
 */
const ENHANCED_MEASUREMENT_EVENTS = [
  // Page views
  'page_view',
  // Scrolls: the first time a user reaches the bottom of each page
  // (i.e., when a 90% vertical depth becomes visible)
  'scroll',
  // Outbound clicks
  'click',
  // Site search
  'view_search_results',
  // Video engagement
  'video_start',
  'video_progress',
  'video_complete',
  // File downloads
  'file_download',
  // Form interactions
  'form_start',
  'form_submit',
];

const AUTOMATICALLY_COLLECTED_EVENTS = [
  ...ENHANCED_MEASUREMENT_EVENTS,
  'first_visit',
  'first_open',
  // ref: https://support.google.com/analytics/answer/9234069
  // 'in_app_purchase',
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'notification_send',
  /**
   * Note: The 'screen_view' event is automatically sent only when using Android or iOS native SDKs.
   * If you are using React Native, you need to send this event manually; it should not be ignored.
   * */
  // 'screen_view',
  'session_start',
  'user_engagement',
];

/** The SDK's own: the server binds the visitor to the user from it; no third party has a use for it. */
const SDK_EVENTS = ['identify'];

export const IGNORED_EVENTS = [...METRICS_EVENTS, ...AUTOMATICALLY_COLLECTED_EVENTS, ...SDK_EVENTS];
