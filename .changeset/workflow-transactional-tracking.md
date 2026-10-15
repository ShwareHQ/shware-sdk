---
'@shware/workflow': patch
---

Tracked links are stored before the email is sent (`MessageTracking.commit`), so an instant click always finds its link; opens and clicks are recorded in one locked transaction with the bot judgement, so concurrent scanner clicks are classified together and backdated consistently; a failure reporting a message as sent no longer fails and retries the send step.
