---
'@shware/analytics': patch
---

OpenAI pixel: `setOpenAIUser` sends the postal code as `postal_code`, the field the pixel documents, instead of `zip_code`, which it ignored. It also sends the hashed phone number, first and last name, and the region, normalized as OpenAI documents (the same `normalizeOAIPhone` / `normalizeOAIName` the Conversions API sender uses), and leaves the city's case to OpenAI.
