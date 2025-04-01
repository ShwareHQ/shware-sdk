# Auth lib

## Hono example

```ts
import { Hono } from 'hono';
import { Auth, RedisIndexedSessionRepository } from '@shware/security';
import { github } from '@shware/security/oauth2/provider';
import { env, type Env } from '../env';
import { redis } from '../db';
import { onAuthorized } from '../services/auth';

// ------------------------------------------------- ⬇️ ioredis ⬇️ namespace
const repository = new RedisIndexedSessionRepository(redis, 'mywebsite:session');
repository.setDefaultMaxInactiveInterval(30 * 24 * 60 * 60);

const auth = new Auth({
  timing: true,
  repository,
  oauth2: {
    client: {
      baseUri: 'https://api.mywebsite.com', // backend
      errorUri: 'https://mywebsite.com', // frontend with query: error=string&error_description=string
      successUri: 'https://mywebsite.com',
      provider: { github },
      registration: {
        github: {
          clientId: env.OAUTH2_GITHUB_CLIENT_ID,
          clientSecret: env.OAUTH2_GITHUB_CLIENT_SECRET,
        },
      },
    },
  },
});

const app = new Hono<Env>();

app.get('/auth', (c) => c.json({ test: 'test' }));
app.get(auth.PATH_LOGGED, (c) => auth.logged(c.req.raw));
app.post(auth.PATH_LOGOUT, (c) => auth.logout(c.req.raw));

app.get(auth.PATH_OAUTH2_STATE, (c) => auth.oauth2State(c.req.raw));
app.get(auth.PATH_OAUTH2_AUTHORIZATION, (c) => auth.oauth2Authorization(c.req.raw));
app.get(auth.PATH_LOGIN_OAUTH2_CODE, (c) => auth.loginOAuth2Code(c.req.raw, onAuthorized));
app.post(auth.PATH_LOGIN_OAUTH2_CODE, (c) => auth.loginOAuth2Code(c.req.raw, onAuthorized));
app.post(auth.PATH_LOGIN_OAUTH2_NATIVE, (c) => auth.loginOAuth2Native(c.req.raw, onAuthorized));

export default app;
```
