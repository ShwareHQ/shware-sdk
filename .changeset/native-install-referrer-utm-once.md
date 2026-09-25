---
'@shware/analytics': patch
---

On native, the install referrer's `utm_*` parameters are attached only on the install launch, the one `first_open` is sent from. The referrer never changes, and it was spread into the tags of every launch, so every session of an Android install reported the install campaign as its own acquisition for as long as the app stayed installed; a report reading a session's tags could not tell the install from the thousandth open. Later launches still send the raw `install_referrer`, without the utm fields. iOS, which has no install referrer, is unchanged.
