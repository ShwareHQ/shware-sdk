/**
 * Who opened or clicked: a person, or a machine acting on the message without one — the split
 * between human and machine engagement that open and click rates are read through. No single
 * signal decides on its own unless it is strong; weak ones only count together, the way the
 * ESPs that publish their approach describe it (a quick click alone is a person on a phone as
 * often as a scanner). Every verdict names the rule that made it, and the request's user agent and
 * network are stored beside it, so the rules can be revisited against history.
 *
 * Strong, alone enough:
 * - `scanner`: a security gateway or link checker announcing itself (Barracuda, Mimecast,
 *   Proofpoint, Safe Links, curl, a headless browser…);
 * - `datacenter` (clicks): the request came from a cloud or security vendor's network (AWS,
 *   Azure, Google Cloud, Proofpoint…), where people do not browse — Microsoft Defender detonates
 *   links from Azure. Not Cloudflare, Akamai or Fastly: iCloud Private Relay egresses there. Not
 *   for opens: Gmail's, Outlook's and Yahoo's image proxies fetch from their own networks when
 *   the person opens the message;
 * - `apple_privacy_proxy` (opens): Apple Mail Privacy Protection, which fetches every image on
 *   delivery through Apple's proxies with the bare `Mozilla/5.0` user agent, read or not;
 * - `head_request` (clicks): a person's click is a GET;
 * - `link_burst` (clicks): three or more different links of one message within a few seconds, or
 *   every link of it — the way a scanner walks a message. Earlier clicks of the burst are
 *   reclassified too (see `recordClick`).
 *
 * Weak, machine only together:
 * - `quick`: within `quickMs` of delivery (1 s by default, `email.tracking.quickClickMs`);
 * - `link_pair`: another link of the same message clicked within a few seconds.
 *
 * Gmail's image proxy fetches when the person opens the message, so its opens count as human —
 * unless it fetched within `quickMs` of delivery (`gmail_prefetch`).
 */

export interface Verdict {
  machine: boolean;
  reason: string | null;
}

export interface RequestFacts {
  method: string;
  userAgent: string | null;
  /** Cloudflare's `request.cf.asOrganization`: who owns the address the request came from. */
  organization: string | null;
  /** Milliseconds between delivering the message and this request. */
  sinceDeliveredMs: number;
}

export interface ClassifyOptions {
  /** A request this soon after delivery is a weak machine signal; 1000 ms by default. */
  quickMs?: number;
}

export interface ClickFacts extends RequestFacts {
  /** The different links of the message clicked within `BURST_WINDOW_MS`, this one included. */
  linksInBurst: number;
  /** How many tracked links the message has. */
  linkCount: number;
}

/** How close together clicks on different links of one message must be to count as one walk. */
export const BURST_WINDOW_MS = 5_000;
export const DEFAULT_QUICK_MS = 1_000;

// Whole words only: "San Francisco" is not Cisco, a CUBOT phone is not a bot
const SCANNER =
  /(?<![a-z])(?:(?!cubot)[a-z]*bot|crawler|spider|headlesschrome|phantomjs|barracuda|mimecast|proofpoint|safelinks|symantec|trend ?micro|forcepoint|zscaler|cisco|fortinet|sophos|messagelabs)(?![a-z])|curl\/|wget\/|python|go-http-client|java\/|okhttp/i;
const DATACENTER =
  /\b(?:amazon|aws|microsoft|azure|google cloud|digitalocean|ovh|hetzner|linode|akamai connected cloud|vultr|oracle|alibaba|tencent|proofpoint|mimecast|barracuda|forcepoint|zscaler|cisco|fortinet|sophos|trend ?micro|symantec|broadcom)\b/i;
const GOOGLE_PROXY = /GoogleImageProxy|ggpht\.com/i;

const human: Verdict = { machine: false, reason: null };
const machine = (reason: string): Verdict => ({ machine: true, reason });

const scanner = (facts: RequestFacts) => SCANNER.test(facts.userAgent?.trim() ?? '');

export function classifyOpen(facts: RequestFacts, options: ClassifyOptions = {}): Verdict {
  const quickMs = options.quickMs ?? DEFAULT_QUICK_MS;
  const agent = facts.userAgent?.trim() ?? '';
  if (agent === 'Mozilla/5.0' || /apple/i.test(facts.organization ?? '')) {
    return machine('apple_privacy_proxy');
  }
  if (GOOGLE_PROXY.test(agent)) {
    return facts.sinceDeliveredMs < quickMs ? machine('gmail_prefetch') : human;
  }
  return scanner(facts) ? machine('scanner') : human;
}

export function classifyClick(facts: ClickFacts, options: ClassifyOptions = {}): Verdict {
  const quickMs = options.quickMs ?? DEFAULT_QUICK_MS;
  if (facts.method === 'HEAD') return machine('head_request');
  if (scanner(facts)) return machine('scanner');
  if (DATACENTER.test(facts.organization ?? '')) return machine('datacenter');
  if (facts.linksInBurst >= 3 || (facts.linkCount >= 2 && facts.linksInBurst >= facts.linkCount)) {
    return machine('link_burst');
  }
  const quick = facts.sinceDeliveredMs < quickMs;
  const pair = facts.linksInBurst >= 2;
  if (quick && pair) return machine('quick+link_pair');
  return human;
}
