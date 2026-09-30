---
'@shware/analytics': patch
---

`botOf` no longer takes a page opened in Facebook's or Instagram's in-app browser for a bot when the app sends its requests with its own user agent (`[FBAN/…]`, `Instagram 445.0.0.34.44 (iPhone…) AppleWebKit/420+`); PostHog, GA4 and Matomo count these as people. Names ShapBot (Parallel, `ai_search`), Shap-User and QuillBot (`ai_assistant`), PromptingBot and Reflectionbot (`ai_crawler`), which were filed as `other`.
