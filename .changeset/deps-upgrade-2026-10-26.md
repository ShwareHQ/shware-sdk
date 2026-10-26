---
'@shware/analytics': patch
'@shware/http': patch
'@shware/purchase': patch
'@shware/security': patch
'@shware/utils': patch
'@shware/workflow': patch
'@shware/workflow-ui': patch
---

Update dependencies to their latest versions within the declared ranges (react 19.3.1, @tanstack/* , posthog-js, jose, stripe, discord-api-types and the rest); `tsdown` stays pinned at 0.23.1 because 0.23.2 pulls a dts plugin that refuses TypeScript 7 without `isolatedDeclarations`.
