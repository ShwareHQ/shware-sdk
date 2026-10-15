---
'@shware/workflow': minor
---

Add `unbindDevice` (store, `POST /devices/unbind`, `JourneyClient.unbindDevice`): signing out keeps the device registered with no user (`device.user_id` is now nullable) instead of removing it, so the next sign-in only binds it again; the former owner's device waits wake. `removeDevice` stays for tokens the push service reports gone. Regenerate the schema and migrate; a D1 database created with `devices.user_id NOT NULL` needs the table rebuilt.
