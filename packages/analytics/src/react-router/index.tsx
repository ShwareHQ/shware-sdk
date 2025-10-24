import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { usePageViewAnalytics } from '../hooks/use-page-view-analytics';
import { track } from '../track/index';
import type { PixelId as MetaPixelId } from '../track/fbq';
import type { GaId, GtmId } from '../track/gtag';
import type { PixelId as RedditPixelId } from '../track/rdt';

type HotjarId = `${number}`;

function useReportWebVitals(reportWebVitalsFn: (metric: Metric) => void) {
  useEffect(() => {
    onCLS(reportWebVitalsFn);
    onLCP(reportWebVitalsFn);
    onINP(reportWebVitalsFn);
    onFCP(reportWebVitalsFn);
    onTTFB(reportWebVitalsFn);
  }, [reportWebVitalsFn]);
}

interface Props {
  gaId?: GaId;
  gtmId?: GtmId;
  metaPixelId?: MetaPixelId;
  redditPixelId?: RedditPixelId;
  hotjarId?: HotjarId;
  facebookAppId?: string;
  nonce?: string;
  debugMode?: boolean;
  reportWebVitals?: boolean;
}

export function Analytics({
  gaId,
  nonce,
  debugMode,
  metaPixelId,
  redditPixelId,
  hotjarId,
  facebookAppId,
  reportWebVitals = true,
}: Props) {
  const { pathname } = useLocation();
  usePageViewAnalytics(pathname);

  useReportWebVitals((metric) => {
    if (!reportWebVitals) return;
    const properties = {
      id: metric.id,
      rating: metric.rating,
      value: metric.value,
      delta: metric.delta,
      navigation_type: metric.navigationType,
      non_interaction: true, // avoids affecting bounce rate.
    };
    track(metric.name, properties);
  });

  return (
    <>
      {facebookAppId && <meta property="fb:app_id" content={facebookAppId} />}
      {gaId && (
        <>
          <script
            async
            id="gtag"
            nonce={nonce}
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
          />
          <script
            async
            nonce={nonce}
            id="gtag-init"
            dangerouslySetInnerHTML={{
              __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${gaId}'${debugMode ? " ,{ 'debug_mode': true }" : ''});
            `,
            }}
          />
        </>
      )}
      {metaPixelId && (
        <script
          async
          id="meta-pixel"
          dangerouslySetInnerHTML={{
            __html: `
            !(function (f, b, e, v, n, t, s) {
              if (f.fbq) return;
              n = f.fbq = function () {
                n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
              };
              if (!f._fbq) f._fbq = n;
              n.push = n;
              n.loaded = !0;
              n.version = '2.0';
              n.queue = [];
              t = b.createElement(e);
              t.async = !0;
              t.src = v;
              s = b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t, s);
            })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${metaPixelId}');
            fbq('track', 'PageView');`,
          }}
        />
      )}
      {redditPixelId && (
        <script
          async
          id="reddit-pixel"
          dangerouslySetInnerHTML={{
            __html: `
            !function(w,d) {
              if(!w.rdt) {
                var p = w.rdt = function() {
                  p.sendEvent ? p.sendEvent.apply(p,arguments) : p.callQueue.push(arguments)
                };
                p.callQueue = [];
                var t = d.createElement("script");
                t.src = "https://www.redditstatic.com/ads/pixel.js";
                t.async = !0;
                var s = d.getElementsByTagName("script")[0];
                s.parentNode.insertBefore(t,s)
              }
            }(window, document);
            rdt('init', '${redditPixelId}');
            rdt('track', 'PageVisit');`,
          }}
        />
      )}
      {hotjarId && (
        <script
          async
          id="hotjar"
          dangerouslySetInnerHTML={{
            __html: `
            (function(h,o,t,j,a,r){
              h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
              h._hjSettings={hjid:${hotjarId},hjsv:6};
              a=o.getElementsByTagName('head')[0];
              r=o.createElement('script');r.async=1;
              r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
              a.appendChild(r);
            })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
            `,
          }}
        />
      )}
    </>
  );
}
