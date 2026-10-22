---
'@shware/security': major
---

Cap guesses per email verification code and throttle resends.

**Security fix.** `loginEmail` compared the six-digit code without counting attempts, so the code could be brute-forced within its 10-minute lifetime. Each login attempt is now counted atomically before the comparison; after `maxAttempts` (default 5) the code is discarded and `loginEmail` answers `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`. `sendEmailVerificationCode` allows one send per email per `resendCooldown` seconds (default 60) and answers `429 VERIFICATION_CODE_RESEND_TOO_SOON` otherwise; a failed delivery releases the cooldown, and a new code resets the attempt budget. Both limits are set through the new `verificationCode: { maxAttempts, resendCooldown }` option of `Auth`.

**Migration**

`KVRepository` has a new required method, `increment(key, expiresIn): Promise<number>`. `RedisKVRepository` implements it; custom implementations must add it. It must be atomic: an absent or expired key is created with value 1 expiring in `expiresIn` seconds, an existing key is incremented and keeps its expiry, and the new count is returned. On Postgres, with `kv(key text primary key, value text, expires_at timestamptz)`:

```sql
insert into kv (key, value, expires_at) values ($1, '1', now() + make_interval(secs => $2))
on conflict (key) do update set
  value = case when kv.expires_at <= now() then '1' else (kv.value::int + 1)::text end,
  expires_at = case when kv.expires_at <= now() then excluded.expires_at else kv.expires_at end
returning value::int;
```

Clients may want to handle the two new error reasons: ask for a new code on `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`, and wait before resending on `VERIFICATION_CODE_RESEND_TOO_SOON`.
