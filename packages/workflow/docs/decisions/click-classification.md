# Telling a person's click from a machine's

Status: **decided 2026-11-28.** The rules are in `src/reporting/classify.ts`; this is why they
are what they are, and what was looked at. Read it before changing them or reporting them as a
defect again (review item 6.2).

## The question

A click on a tracked link is recorded as a person's or a machine's, and the click rates Studio
shows count people only. A review asked whether judging by the network a request came from
(`datacenter`) is sound: an employee behind a corporate gateway clicks from the gateway vendor's
network and was counted as a machine, always.

## What other products do

Looked up 2026-11-27.

| Product     | Signals                                                                                                                                             | The network as a signal                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Omeda       | Ten rules: two clicks within 2 s, 10+ within 30 s, a click within 5 s of the send, a scanner user-agent list, IP lists, an invisible "stealth" link | Its own bot IP list is on. **Data-centre ranges (AWS, Google Cloud, Azure) are an opt-in, off by default** |
| HubSpot     | IP addresses on blocklists, and behaviour (how quickly interactions happen)                                                                         | On by default; no detail                                                                                   |
| Customer.io | Security scanners, bot user agents, **known proxy services**, repetitive click patterns                                                             | On, not adjustable                                                                                         |
| Mailchimp   | Device fingerprint, an IP intelligence list, third-party behavioural analysis, bursts from one IP within seconds                                    | On                                                                                                         |
| Braze       | "Multiple inputs"; the exported reason names `user_agent` and `ip_address`                                                                          | No detail                                                                                                  |
| Klaviyo     | "A number of different factors"                                                                                                                     | No detail                                                                                                  |

What they agree on:

- **Several signals, not one.** Nobody publishes a single rule.
- **The raw click is kept and the verdict carries a reason.** HubSpot shows the numbers with and
  without bots; Omeda and Braze export a reason code.
- **Time alone does not decide.** Omeda argues against "fast means bot" in both directions:
  people click within three seconds on a phone, and scanners come back a week later to scan
  again. A late rescan is caught only by who is asking (user agent, network), which is why the
  network cannot be dropped to a weak signal altogether.
- **Nobody treats every network signal as weak.** Omeda, the most careful, makes only the
  data-centre ranges optional.

Where they differ, and it is the case in question: Customer.io counts known proxies as machines
outright, and says in the same page that a scanner following a single link can still count as a
person, more so for an audience behind corporate gateways. Both ways of being wrong are in use.

A hidden link no person can see (Omeda, a SAP patent, Validity) catches scanners reliably;
Mailchimp and Validity warn that mailbox providers may read it as a spam trait. Not built.

### How far to trust this

- Read directly: Omeda's article, HubSpot's, Braze's and Klaviyo's help pages, Customer.io's
  analytics page, Mailchimp's resource page.
- Not read: Marketo's page (it did not load). Nothing here rests on it.
- No vendor states how often a person behind a gateway is misread, or how many of Microsoft
  Defender's scans happen at the moment of the click. There is no measurement behind the choice
  below, only the mechanism.

### Sources

- Omeda: [Bot Clicks in Email](https://www.omeda.com/resources/report/bot-clicks-in-email/)
- HubSpot: [Understand bot filtering in marketing email analytics](https://knowledge.hubspot.com/marketing-email/understand-bot-filtering-in-marketing-email-analytics)
- Customer.io: [Analytics](https://docs.customer.io/journeys/analytics/)
- Mailchimp: [Bot clicks in email marketing](https://mailchimp.com/resources/bot-clicks-in-email-marketing/)
- Braze: [Bot filtering for emails](https://braze.com/docs/user_guide/administer/global/workspace_settings/email_preferences/bot_filtering)
- Klaviyo: [Bot clicks](https://help.klaviyo.com/hc/en-us/articles/22981852783899)
- Validity: [Are these clicks for real?](https://www.validity.com/blog/are-these-clicks-for-real-the-rise-of-bot-clicks-and-what-marketers-can-do-about-it/)
- SAP: [US 12,489,787, Email bot click detection](https://patentsgazette.uspto.gov/week48/OG/html/1541-1/US12489787-20251202.html)

## Decisions

1. **The approach stays**: strong signals decide alone, weak ones only together, the raw click
   and the reason are stored. It is what the surveyed products do.
2. **A cloud's or a mail security vendor's network stays a strong signal** (`datacenter`):
   AWS, Azure, Google Cloud, the hosting companies, Proofpoint, Mimecast, Barracuda. People do
   not browse from there. Microsoft is in this group on purpose: Safe Links rewrites the link,
   the person's own click then arrives from the person's network, and what arrives from
   Microsoft's is the scan.
3. **A web proxy vendor's network is a weak signal** (`proxy`): Zscaler, Cisco, Forcepoint,
   Fortinet, Sophos, Symantec/Broadcom, Trend Micro. A company's staff browse through these, so
   the vendor's scanner and the employee's browser leave from the same network. It is a machine
   with `quick` or `link_pair`, a person alone. Before this they were in `datacenter`, and an
   employee clicking one link minutes after delivery was always a machine.
4. **The error accepted in exchange**: such a vendor's scanner that follows one link, late, with
   a browser's user agent, counts as a person. Customer.io documents the same limit.
5. **History is not reclassified.** The stored network and reason allow it later, once the rule
   has been checked against real traffic.
6. **Not configurable**, as before. A list a deployment can edit is a list nobody maintains.

## Known limits

- **The network is known on Cloudflare only** (`request.cf.asOrganization`). The AWS and Node
  hosts pass none, so `datacenter` and `proxy` never fire there and the two hosts' human click
  rates are not the same measure.
- The vendor lists are names matched against the network's organization, kept by hand.
- A person on a VPN or a cloud desktop hosted in AWS or Azure is counted as a machine.
