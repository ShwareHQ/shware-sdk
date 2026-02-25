import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { useClickIdPersistence } from '../hooks/use-click-id-persistence';
import { useOutboundClickAnalytics } from '../hooks/use-outbound-click-analytics';
import { useWebAnalytics } from '../hooks/use-web-analytics';
import type { PixelId as MetaPixelId } from '../track/fbq';
import type { GaId, GtmId } from '../track/gtag';
import { track } from '../track/index';
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
  linkedInPartnerId?: `${number}`;
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
  linkedInPartnerId,
  hotjarId,
  facebookAppId,
  reportWebVitals = true,
}: Props) {
  useClickIdPersistence();

  const { pathname } = useLocation();
  useWebAnalytics(pathname);
  useOutboundClickAnalytics();

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
      {linkedInPartnerId && (
        <script
          async
          id="linkedin-insight-tag"
          dangerouslySetInnerHTML={{
            __html: `
            _linkedin_partner_id = "${linkedInPartnerId}";
            window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
            window._linkedin_data_partner_ids.push(_linkedin_partner_id);

            (function(l) {
              if (!l){
                window.lintrk = function(a,b){
                  window.lintrk.q.push([a,b])
                };
                window.lintrk.q=[]
              }
              var s = document.getElementsByTagName("script")[0];
              var b = document.createElement("script");
              b.type = "text/javascript";b.async = true;
              b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
              s.parentNode.insertBefore(b, s);
            })(window.lintrk);
            `,
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
