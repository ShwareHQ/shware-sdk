---
'@shware/analytics': minor
---

`getProbabilisticFingerprint` no longer reads the clipboard by default (`shouldUseClipboard` defaults to `false`), since reading it shows the system's "pasted from" banner on iOS 14+ and Android 12+. Pass `true` to keep collecting the pasted link.
