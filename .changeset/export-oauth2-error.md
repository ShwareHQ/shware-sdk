---
'@shware/security': patch
---

Export `OAuth2Error` (and `OAuth2ErrorType`) from the package root, so an api can recognise a provider's refusal in its error handler and answer 4xx instead of 500.
