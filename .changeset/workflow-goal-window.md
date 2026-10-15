---
'@shware/workflow': minor
---

The conversion window outlives the flow: a journey that has run all its steps while its goal's `within` is still open keeps watching for the goal (anchored at entry) until the window closes, and ends as `goal` when it is met. A purchase after the last offer email now counts as that journey's conversion instead of landing after a plain `completed`. Goals without a window still end with the flow.
