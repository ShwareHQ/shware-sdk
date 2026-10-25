---
'@shware/analytics': major
---

Pass `nonce` to every script the `Analytics` component renders (Meta, Reddit, LinkedIn, Microsoft UET, OpenAI and Hotjar snippets, not just gtag) on TanStack Start, React Router and Next, so pixels load under a nonce-based CSP; removed the unimplemented `gtmId` prop and the `GtmId` type.
