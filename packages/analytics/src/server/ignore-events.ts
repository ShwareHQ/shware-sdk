const metrics = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];
const session = ['session_start', 'session_end', 'page_view', 'screen_view'];

export const IGNORE_EVENTS = [...metrics, ...session];
