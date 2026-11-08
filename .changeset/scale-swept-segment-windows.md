---
'@shware/workflow': patch
---

Scale the segment definitions read by the scheduled sweep (`listSegments`) and the profile gates of event trigger routes (`findTriggers`) with the debug time scale, as event-driven evaluation already does; production (factor 1) is unchanged.
