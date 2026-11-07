---
'@shware/analytics': patch
---

Compile `botOf`'s generic bot pattern on first use instead of at import, and leave out its lookbehind patterns where the engine cannot compile them. Safari before 16.4 threw `SyntaxError: Invalid regular expression: invalid group specifier name` while loading any chunk that bundled the bot module.
