---
'@shware/workflow-ui': patch
---

The Segments list names each segment by its label, else its id made readable (`used_api` → "Used api": underscores become spaces, the first letter is capitalized in CSS; no more "Untitled"), and its second line is the segment's description in the regular face — shown only when there is one — instead of the condition in monospace.

The Segments page and the Home count list every deployed segment, whether a workflow uses it yet or not ("Not used by any workflow"), plus referenced ones that are not deployed; previously only segments a workflow referenced appeared. The Message Metrics table keys its rows by node and channel, so a push node reported for iOS and Android renders two rows without a duplicate-key warning.
