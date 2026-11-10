---
'@shware/analytics': patch
---

Ad platform scripts (Meta, Reddit, LinkedIn, Microsoft UET, OpenAI) no longer run on a development host: their snippets report a page view as they load, before any sender's local check, so a `*.localhost` page showed up at the platform as a new domain sending data. The local check is one exported `isLocalHost()`, which matches `localhost`, `*.localhost` and `127.0.0.1` exactly rather than any host containing the word.
