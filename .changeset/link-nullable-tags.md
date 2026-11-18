---
'@shware/analytics': patch
---

`Link` types an unset optional UTM tag as `string | null`, which is what the server answers, so a server can type its response as `Link` without mapping the row.
