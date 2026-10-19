---
'@shware/utils': minor
'@shware/analytics': patch
---

Expose usePrevious from @shware/utils and reuse it in analytics while preserving its effect-updated previous-render snapshot behavior and targeted React refs exemption. Keep Activity restoration, Strict Mode, and suspended navigation coverage. No API dependencies change.
