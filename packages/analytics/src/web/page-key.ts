/**
 * What makes two URLs "the same page" for page views and the page load id.
 *
 * Path plus query, in line with GA4's enhanced measurement (a history change with a new path
 * or query is a page view), Next.js's documented pattern (`usePathname` + `useSearchParams`)
 * and PostHog's `history_change`: `?page=2` and `?q=shoes` are different pages to a funnel.
 * The hash is not part of it — an in-page anchor is not a navigation, and GA4 ignores
 * fragment-only changes by default too.
 *
 * Tracking parameters are stripped before comparing. A landing page commonly cleans `utm_*`
 * and the ad click ids out of its URL with `replaceState` once they are captured; keyed on the
 * raw query, that cleanup would count as a second page view of the landing page. (GA4 has this
 * quirk; the usual advice is to strip before comparing.) The parameters are the ones `getTags`
 * captures — nothing a page's own state lives in.
 */

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'gad_source',
  'gad_campaignid',
  'gbraid',
  'wbraid',
  'dclid',
  'msclkid',
  'rdt_cid',
  'li_fat_id',
  'ttclid',
  'twclid',
  'sccid',
  'ko_click_id',
  'yclid',
]);

function isTrackingParam(name: string): boolean {
  return name.startsWith('utm_') || TRACKING_PARAMS.has(name);
}

/**
 * `pathname` plus the query with tracking parameters removed and the rest sorted, so two URLs
 * that differ only in tracking decoration or parameter order map to one key.
 */
export function getPageKey(pathname: string, search = ''): string {
  const params = new URLSearchParams(search);
  for (const name of Array.from(params.keys())) {
    if (isTrackingParam(name)) params.delete(name);
  }
  params.sort();
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
