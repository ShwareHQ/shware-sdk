---
'@shware/workflow': patch
---

A click from a corporate web proxy is no longer a machine's on the network alone.

Clicks arriving from Zscaler, Cisco, Forcepoint, Fortinet, Sophos, Symantec/Broadcom or Trend Micro networks were classified `datacenter`, so an employee behind such a gateway never counted as a person. Staff browse through these networks, so they are now a weak signal: a machine's click when it also came within `quickClickMs` of delivery (`proxy+quick`) or with another link of the message (`proxy+link_pair`), a person's otherwise. Clouds and mail security vendors (AWS, Azure, Google Cloud, Proofpoint, Mimecast, Barracuda…) are unchanged. Clicks already recorded keep their verdict; human click rates for audiences behind these gateways will read higher from here on. The reasoning and what other products do are in `docs/decisions/click-classification.md`.
