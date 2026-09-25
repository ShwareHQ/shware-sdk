---
'@shware/analytics': patch
---

On native, the install referrer's `utm_*` parameters are attached only on the install launch: the first launch that resolves the referrer claims them, with a marker of its own in storage, and every later launch sends the raw `install_referrer` without the utm fields. A launch that cannot reach the Play Store service, which is common right after an install, does not spend the claim, so a later launch still attributes the install. The referrer never changes, and it was spread into the tags of every launch, so every session of an Android install reported the install campaign as its own acquisition for as long as the app stayed installed; a report reading a session's tags could not tell the install from the thousandth open. iOS, which has no install referrer, is unchanged.
