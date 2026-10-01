---
'@shware/analytics': patch
---

Send the OpenAI Conversions API `user` object in the fields the API documents: the plural, hashed lists `emails_sha256`, `phone_numbers_sha256`, `external_ids_sha256`, `first_names_sha256`, `last_names_sha256` and the raw `regions`, `postal_codes`, `cities`, `countries`, from every email, phone number and address given rather than the first, normalized as documented. The singular `email_sha256`, `external_id_sha256`, `country`, `city` and `zip_code` it sent before are not in the API. Also sends the pixel's `__obref` cookie as `user.obref`, the GAID of Android events as `android_advertising_id`, and the pixel's `__oppref` cookie as `oppref` when the page URL carries none.
