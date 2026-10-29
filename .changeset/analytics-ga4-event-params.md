---
'@shware/analytics': minor
---

GA4 recommended-event parameters brought up to the current reference: `purchase` gains the optional `customer_type` (`'new' | 'returning'`); an `Item` needs one of `item_id` / `item_name` instead of both (the Meta and Reddit mappers report `item_name` as the id when `item_id` is absent, via the new `itemKey()`); `close_convert_lead` takes `currency` / `value` as optional.
