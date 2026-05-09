# Desktop / Native App Sign-in

> Two-step web-loopback auth-code flow for native desktop apps (Electron, Tauri, etc.). Consumes the same `Auth` instance that already serves your web sign-in — no parallel auth stack required.

## Why

Native desktop apps shouldn't host their own sign-in form. A few reasons:

- **CAPTCHA defenses don't survive on desktop**. `sendEmailVerificationCode` requires a Cloudflare Turnstile token; Turnstile widgets refuse to load under `file://` / non-HTTP(S) origins. If the desktop app bypasses that check via a UA / Origin marker, attackers can spoof the marker — every "trust the desktop client" signal can be forged from `curl`.
- **OAuth providers reject embedded webviews**. [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252) and the Google / Apple identity guidelines explicitly forbid OAuth in embedded browsers. Desktop must launch the system browser anyway.
- **Maintenance**. Your web sign-in already has Turnstile + OAuth + verification code + i18n + form validation. Reimplementing it in the desktop renderer doubles the surface.

The standard answer (what Slack, Linear, GitHub Desktop, VSCode, Cursor all do): **let the system browser do sign-in, hand the resulting credential back to the desktop client over a loopback redirect**. This SDK ships two endpoints to make that handoff secure.

## Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│  desktop main process                                                │
│   1. spawn ephemeral HTTP server: http://127.0.0.1:RANDOM_PORT      │
│   2. generate random `state` (UUID) and PKCE pair:                   │
│        verifier  = base64url(random(32))                             │
│        challenge = base64url(sha256(verifier))                       │
│      keep verifier in main-process memory only                       │
│   3. shell.openExternal(                                             │
│        https://yourapp.com/sign-in?                                  │
│          desktop_callback=http://127.0.0.1:PORT&                     │
│          state=STATE&                                                │
│          desktop_challenge=CHALLENGE&                                │
│          via=google|apple|email                                      │
│      )                                                               │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  system browser (your web app)                                       │
│   4. /sign-in page reads desktop_callback / state / challenge,       │
│      persists in sessionStorage (survives intermediate OAuth         │
│      redirects)                                                      │
│   5. user signs in (any method — Turnstile, OAuth, verification      │
│      code). Browser ends with a valid cookie session.                │
│   6. SPA detects sessionStorage marker, calls                        │
│        POST /auth/desktop/authorize                                  │
│          { code_challenge, code_challenge_method: 'S256' }           │
│        (cookie sent automatically)                                   │
│      → server pins challenge to a 5-min single-use code,             │
│        returns { code }                                              │
│   7. SPA: location.replace(callback + '?code=...&state=...')         │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  desktop main process / renderer                                     │
│   8. loopback server receives GET /?code=...&state=...               │
│   9. main verifies state, closes server, returns 200 HTML            │
│  10. main hands `code` + held `verifier` to renderer (IPC bridge)    │
│  11. renderer fetches:                                               │
│        POST https://api.yourapp.com/auth/desktop/exchange            │
│          { code, code_verifier }, credentials: 'include'             │
│      → server checks sha256(verifier) === stored challenge,          │
│        consumes code (single-use → KV.removeItem),                   │
│        creates fresh session, replies with                           │
│        Set-Cookie: SESSION=...; HttpOnly; Secure; SameSite=None      │
│  12. Chromium stores the cookie in the renderer's webContents        │
│      session jar. Subsequent fetches with `credentials: 'include'`   │
│      include it automatically.                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## API surface

Two new methods on the `Auth` class, plus two new path constants on `PATH`:

```ts
import { Auth, PATH } from '@shware/security';

// PATH.DESKTOP_AUTHORIZE === '/auth/desktop/authorize'
// PATH.DESKTOP_EXCHANGE  === '/auth/desktop/exchange'
```

### `desktopAuthorize(request) → Response`

Web side. Caller must be authenticated (cookie session, same auth your other methods use). Pins a PKCE challenge to a 5-minute single-use code.

```ts
// Request body (PKCE per RFC 7636, S256 only)
{ "code_challenge": "<base64url(sha256(verifier))>", "code_challenge_method": "S256" }

// JSON response
{ "code": "5e2c8e94-7b1f-4a3a-9e1b-2c8c3a14f9d3" }

// Stored in KV under `desktop:code:<code>` → { name, cc }, TTL 300s.
// Anonymous callers receive HTTP 401 / UNAUTHENTICATED.
// Missing/malformed challenge → 400 / INVALID_ARGUMENT.
```

The endpoint sets no cookie — it's used from a context that already has one.

### `desktopExchange(request) → Response`

Desktop side. Hands the loopback-received code + the matching `code_verifier` back to mint a fresh session. The response carries a `Set-Cookie` for a brand-new session record (`client_type: 'desktop'`), independent of the web cookie session that authorized it.

```ts
// Request body
{ "code": "<from authorize>", "code_verifier": "<from desktop main>" }

// Response
HTTP 200
Set-Cookie: SESSION=<id>; HttpOnly; Secure; SameSite=None; Max-Age=...
{ "ok": true }

// PKCE check (timing-safe): sha256(verifier) === stored challenge.
// Verifier mismatch → 400 / INVALID_DESKTOP_CODE; the code is NOT
// consumed on mismatch (a network retry of a legit exchange still
// works), but the 5-min TTL bounds brute-force attempts.
// On success: code is removed from KV before the session is created —
// concurrent duplicate exchanges resolve to one success / one
// INVALID_DESKTOP_CODE.
```

`SameSite=None` is forced regardless of your `cookie` config so the cookie survives the desktop renderer's cross-site fetches (`file://` / `app://` → `https://api.yourapp.com`). The configured `cookie.domain` / `cookie.path` / `cookie.httpOnly` flow through unchanged.

## Wiring

### Server (Hono example)

```ts
import { PATH } from '@shware/security';
import { auth } from '@/config/security'; // your Auth instance

app.post(PATH.DESKTOP_AUTHORIZE, (c) => auth.desktopAuthorize(c.req.raw));
app.post(PATH.DESKTOP_EXCHANGE, (c) => auth.desktopExchange(c.req.raw));
```

CSRF middleware:

- `DESKTOP_AUTHORIZE` is a cookie-bearing POST — protect with your usual CSRF check (the SDK's double-submit cookie machinery works).
- `DESKTOP_EXCHANGE` is cookie-less — the auth code is the credential, KV single-use blocks replay, no CSRF needed.

### Web (any framework)

```tsx
// On the /sign-in route mount: capture callback params into sessionStorage
// so they survive OAuth's third-party hop.
useEffect(() => {
  const url = new URL(window.location.href);
  const callback = url.searchParams.get('desktop_callback');
  const state = url.searchParams.get('state');
  const challenge = url.searchParams.get('desktop_challenge');
  if (!callback || !state || !challenge) return;
  // Reject anything that isn't loopback — phishing protection.
  if (!/^http:\/\/127\.0\.0\.1:\d+(\/.*)?$/.test(callback)) return;
  // Challenge must look like a PKCE S256 base64url string.
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return;
  sessionStorage.setItem('desktop_callback', callback);
  sessionStorage.setItem('desktop_state', state);
  sessionStorage.setItem('desktop_challenge', challenge);
}, []);

// On any successful sign-in (your existing post-login hook):
async function maybeRedirectToDesktop(): Promise<boolean> {
  const callback = sessionStorage.getItem('desktop_callback');
  const state = sessionStorage.getItem('desktop_state');
  const challenge = sessionStorage.getItem('desktop_challenge');
  if (!callback || !state || !challenge) return false;
  sessionStorage.removeItem('desktop_callback');
  sessionStorage.removeItem('desktop_state');
  sessionStorage.removeItem('desktop_challenge');

  const res = await fetch('/auth/desktop/authorize', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code_challenge: challenge, code_challenge_method: 'S256' }),
  });
  if (!res.ok) return false;
  const { code } = (await res.json()) as { code: string };

  const target = new URL(callback);
  target.searchParams.set('code', code);
  target.searchParams.set('state', state);
  window.location.replace(target.href);
  return true;
}
```

Hook `maybeRedirectToDesktop` into:

1. Your post-login event handler (after every successful sign-in), and
2. Your initial-load auth check — if the user revisits `/sign-in?desktop_callback=...` while already signed in, no fresh login fires; you must run the redirect once `logged === true` resolves.

### Desktop (Electron example)

Main process — loopback server:

```ts
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { shell } from 'electron';

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startLoopbackSignIn(provider: 'google' | 'apple' | 'email') {
  return new Promise<{ code: string; codeVerifier: string }>((resolve, reject) => {
    const state = randomUUID();
    // PKCE: 32 random bytes → 43-char base64url verifier; challenge = sha256.
    // Keep verifier in main-process closure only; never thread it through
    // any URL or storage that the browser / renderer can observe.
    const codeVerifier = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
    let settled = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        finish(() => {
          res.writeHead(400).end('sign-in failed');
          reject(new Error(error));
        });
        return;
      }
      if (!code || !returnedState) {
        res.writeHead(404).end('not found');
        return;
      }
      if (returnedState !== state) {
        finish(() => {
          res.writeHead(400).end('state mismatch');
          reject(new Error('STATE_MISMATCH'));
        });
        return;
      }

      finish(() => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<h1>Signed in</h1><p>You can close this tab.</p>');
        resolve({ code, codeVerifier });
      });
    });

    const timeout = setTimeout(
      () => {
        finish(() => reject(new Error('SIGN_IN_TIMEOUT')));
      },
      5 * 60 * 1000
    );

    function finish(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        server.close();
      } catch {}
      fn();
    }

    // listen(0): OS picks an unused port — never reuse a fixed port,
    // co-resident malware can pre-listen on it and steal the code.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      const url = new URL('https://yourapp.com/sign-in');
      url.searchParams.set('desktop_callback', `http://127.0.0.1:${port}/`);
      url.searchParams.set('state', state);
      url.searchParams.set('desktop_challenge', codeChallenge);
      url.searchParams.set('via', provider);
      void shell.openExternal(url.href);
    });
  });
}
```

Renderer — exchange the code + verifier for a cookie:

```ts
async function signIn(provider: 'google' | 'apple' | 'email') {
  // 1. main starts the loopback dance, awaits the code + the verifier
  //    it generated. The verifier crosses the IPC bridge once; never
  //    persist it (memory-only, dies with the renderer).
  const { code, codeVerifier } = await ipc.auth.startSignIn(provider);
  // 2. POST the pair; Chromium picks up Set-Cookie automatically.
  await fetch('https://api.yourapp.com/auth/desktop/exchange', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  // 3. Subsequent calls just need credentials: 'include' — done.
}
```

## Security considerations

- **`state` parameter is required**. It defends the loopback against locally-resident malware crafting `http://127.0.0.1:PORT/?code=fake` against your server. The loopback handler must `state === expected` strict-equal — anything else terminates the flow.
- **Auth code never sees the server twice**. `desktopExchange` removes the KV entry before creating the session; concurrent exchanges (e.g. retry-after-network-hiccup) resolve to one success and one `INVALID_DESKTOP_CODE`.
- **Cookie has `SameSite=None`, but session is isolated**. The desktop session is a separate Redis row from the web cookie session that authorized the code. Logging out on either side doesn't cascade. To enumerate / revoke, query sessions with `client_type === 'desktop'`.
- **`Secure` requires HTTPS for the API**. `SameSite=None` + `Secure` is the only combination Chromium accepts cross-site. Plain `http://localhost:8080` will refuse the cookie. In dev, run your API on HTTPS (`mkcert localhost` is the easy path).
- **PKCE (S256) is required**. The auth code travels through the system browser's URL bar and lands in browser history, browser-extension URL listeners, and (on the loopback hop) any process able to read the `127.0.0.1:PORT` packets. PKCE makes the code useless on its own — the verifier never leaves the desktop main process. RFC 7636 §4.4.1 mandates S256 for native clients; the SDK rejects `plain` and any other method. A 32-byte random verifier is the recommended size (43-char base64url). The server accepts 43-128 char verifiers/challenges per the spec.
- **`shell.openExternal` URL must be trusted**. Build it from a constant origin you control, not from user input.

## Threat model differences vs. web

The desktop flow loses the `SameSite=Lax` CSRF defense web cookies have, **but it doesn't matter in the desktop context**:

- Web's CSRF threat is "attacker site B in user's regular Chrome, abusing the user's browser cookies for `api.yourapp.com`". `SameSite=Lax` blocks that.
- Desktop's cookie lives in the Electron renderer's `webContents.session` cookie jar — a different jar from the user's regular browser. Site B in Chrome can't reach it.
- The cookie is only reachable by JS running **inside the desktop renderer**. That's an XSS scenario, against which `SameSite` is no defense regardless. `HttpOnly` still helps — XSS can't read the cookie value to exfiltrate, only piggyback on `fetch`.

## Operational runbook

- **Force-logout a user across all desktops**: existing `kick(principal)` clears every session for that principal.
- **List a user's desktop sessions**: `listSessions(principal)` filtered by `session.getAttribute('client_type') === 'desktop'`.
- **Tune desktop-session TTL independently from web**: out of scope for this version — the SDK uses the same `setDefaultMaxInactiveInterval` for all sessions. If you need split TTLs, override on the session object directly inside an `onAuthorized`-style hook before saving.

## Limitations

- **Remote dev / VPN'd browsers**: the user's browser is on a remote host while the desktop app runs locally → `127.0.0.1` is not the same machine → loopback never receives the redirect. RFC 8252 documents this case; the standard fallback is OAuth Device Flow (user reads a `user_code`, types it into the browser). Not implemented in this SDK.
- **Sandboxed Mac App Store distribution**: TCP `listen` requires the `com.apple.security.network.server` entitlement.
- **Custom protocol fallback**: this SDK only supports loopback. If you need `myapp://` deep-link handling instead (e.g. Windows / Linux environments where loopback is fragile), wire it at the desktop client level — the server-side `desktopAuthorize` / `desktopExchange` pair are agnostic to the redirect channel.
