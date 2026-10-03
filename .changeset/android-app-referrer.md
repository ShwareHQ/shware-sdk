---
'@shware/analytics': minor
---

`classifyTouch` reads an Android app's referrer (`android-app://<package>`) as the site it stands for (`ANDROID_APP_HOSTS`): the Google app as a Google search, Gmail, LinkedIn, Reddit, Telegram and the other listed apps as their sites, an unlisted package as a referring host — before, every one of them was direct. Adds the `gmail` channel (`mail.google.com`, medium `email`, which was read as a Google search) and `telegram` (`t.me`, `telegram.org`). Reclassify stored sessions after upgrading.
