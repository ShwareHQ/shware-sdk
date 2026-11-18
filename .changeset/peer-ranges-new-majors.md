---
'@shware/analytics': patch
'@shware/http': patch
'@shware/workflow': patch
---

Accept the new majors of optional peers: `@react-native-firebase/analytics` 27 in `@shware/analytics` (`^26.4.1 || ^27.0.0`), `i18next` 27 in `@shware/http` (`^26.5.10 || ^27.0.0`; `getErrorMessage` keeps its signature and works with both), and `@aws/durable-execution-sdk-js` 3 in `@shware/workflow` (`^2.7.0 || ^3.0.0`). The `@shware/workflow` Postgres store and the `@shware/workflow-ui` stats source are now tested against `postgres` 4, which their `>=3.4.0` peer range already allowed.
