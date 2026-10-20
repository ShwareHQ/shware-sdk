---
'@shware/workflow': minor
---

Emails with an unsubscribe link now carry `List-Unsubscribe` (RFC 2369), so a mail client's own unsubscribe button works.

- With reporting on, the header names the copy's one-click endpoint `/t/u/<message>`, together with `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, which Gmail and Yahoo require for bulk senders). The provider's POST there unsubscribes at once. A GET on the same URL now shows the confirmation page.
- Without reporting, the header names the template's own unsubscribe link, with no one-click claim.
- An email without an unsubscribe link gets no list headers, and only https URLs are named.
- `EmailMessage.headers` carries the headers to the transports. SES sends them as `Content.Simple.Headers`, Cloudflare Email (binding and REST) as `headers`, and `MessageTracking.unsubscribe` is the one-click endpoint reporting provides.
