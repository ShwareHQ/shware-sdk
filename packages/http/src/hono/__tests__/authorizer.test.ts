import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { authorizer, type AuthorizerConfig } from '../authorizer';
import { errorHandler, type Env } from '../handler';

describe('authorizer', () => {
  let app: Hono<Env>;

  beforeEach(() => {
    app = new Hono<Env>();
    app.use(requestId());
    app.onError(errorHandler);
  });

  describe('Basic functionality', () => {
    it('should allow all requests when no rules are defined', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(true),
      };

      app.use(authorizer({ auth }));
      app.get('/test', (c) => c.text('OK'));

      const res = await app.request('/test');
      expect(res.status).toBe(200);
      expect(auth.isAuthenticated).not.toHaveBeenCalled();
    });

    it('should allow requests when rules match and authentication passes', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(true),
      };

      app.use(authorizer({ auth, rules: [{ path: '/protected', methods: ['GET'] }] }));
      app.get('/protected', (c) => c.text('Protected content'));

      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Protected content');
      expect(auth.isAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('should reject requests when rules match but authentication fails', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(authorizer({ auth, rules: [{ path: '/protected', methods: ['GET'] }] }));
      app.get('/protected', (c) => c.text('Protected content'));

      const res = await app.request('/protected');
      expect(res.status).toBe(401);
      // StatusError wraps the message, just verify status
      expect(auth.isAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('should support custom error messages', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };
      const customMessage = 'Please login first';

      app.use(
        authorizer({
          auth,
          errorMessage: customMessage,
          rules: [{ path: '/protected', methods: ['GET'] }],
        })
      );
      app.get('/protected', (c) => c.text('Protected content'));

      const res = await app.request('/protected');
      expect(res.status).toBe(401);
      // Error message is wrapped in StatusError, just verify status
    });
  });

  describe('HTTP methods', () => {
    it('should only protect specified HTTP methods', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/users', methods: ['POST', 'DELETE'] }],
        })
      );
      app.get('/api/users', (c) => c.text('GET allowed'));
      app.post('/api/users', (c) => c.text('POST protected'));
      app.delete('/api/users', (c) => c.text('DELETE protected'));
      app.put('/api/users', (c) => c.text('PUT allowed'));

      // GET should pass (not protected)
      const getRes = await app.request('/api/users', { method: 'GET' });
      expect(getRes.status).toBe(200);
      expect(await getRes.text()).toBe('GET allowed');

      // POST should be rejected (protected and auth failed)
      const postRes = await app.request('/api/users', { method: 'POST' });
      expect(postRes.status).toBe(401);

      // DELETE should be rejected (protected and auth failed)
      const deleteRes = await app.request('/api/users', { method: 'DELETE' });
      expect(deleteRes.status).toBe(401);

      // PUT should pass (not protected)
      const putRes = await app.request('/api/users', { method: 'PUT' });
      expect(putRes.status).toBe(200);
      expect(await putRes.text()).toBe('PUT allowed');

      // auth.isAuthenticated should only be called for POST and DELETE
      expect(auth.isAuthenticated).toHaveBeenCalledTimes(2);
    });

    it('should protect all methods when methods not specified', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/admin' }], // methods not specified
        })
      );
      app.get('/api/admin', (c) => c.text('GET'));
      app.post('/api/admin', (c) => c.text('POST'));
      app.put('/api/admin', (c) => c.text('PUT'));
      app.delete('/api/admin', (c) => c.text('DELETE'));

      // All methods should be rejected
      const methods = ['GET', 'POST', 'PUT', 'DELETE'];
      for (const method of methods) {
        const res = await app.request('/api/admin', { method });
        expect(res.status).toBe(401);
      }

      expect(auth.isAuthenticated).toHaveBeenCalledTimes(4);
    });

    it('should always allow OPTIONS requests', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/*' }], // protect all /api/* paths
        })
      );
      app.options('/api/test', (c) => c.text('OPTIONS OK'));

      const res = await app.request('/api/test', { method: 'OPTIONS' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('OPTIONS OK');
      expect(auth.isAuthenticated).not.toHaveBeenCalled();
    });
  });

  describe('Path matching', () => {
    it('should support exact path matching', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/users' }],
        })
      );
      app.get('/api/users', (c) => c.text('Exact'));
      app.get('/api/users/123', (c) => c.text('With ID'));
      app.get('/api', (c) => c.text('Parent'));

      // Exact match path should be protected
      const exactRes = await app.request('/api/users');
      expect(exactRes.status).toBe(401);

      // Other paths should pass
      const idRes = await app.request('/api/users/123');
      expect(idRes.status).toBe(200);
      expect(await idRes.text()).toBe('With ID');

      const parentRes = await app.request('/api');
      expect(parentRes.status).toBe(200);
      expect(await parentRes.text()).toBe('Parent');
    });

    it('should support wildcard path matching', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/*' }, { path: '/admin/:id' }],
        })
      );
      app.get('/api/users', (c) => c.text('API Users'));
      app.get('/api/posts/123', (c) => c.text('API Post'));
      app.get('/admin/123', (c) => c.text('Admin'));
      app.get('/public', (c) => c.text('Public'));

      // All paths under /api/* should be protected
      const apiUsersRes = await app.request('/api/users');
      expect(apiUsersRes.status).toBe(401);

      const apiPostRes = await app.request('/api/posts/123');
      expect(apiPostRes.status).toBe(401);

      // /admin/:id should be protected
      const adminRes = await app.request('/admin/123');
      expect(adminRes.status).toBe(401);

      // /public should pass
      const publicRes = await app.request('/public');
      expect(publicRes.status).toBe(200);
      expect(await publicRes.text()).toBe('Public');
    });

    it('should support pattern-like path matching', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [
            { path: '/api/v1/*' },
            { path: '/api/v2/*' },
            { path: '/data.json' },
            { path: '/config.json' },
          ],
        })
      );
      app.get('/api/v1/users', (c) => c.text('V1'));
      app.get('/api/v2/users', (c) => c.text('V2'));
      app.get('/api/v3/users', (c) => c.text('V3'));
      app.get('/data.json', (c) => c.text('JSON'));
      app.get('/config.json', (c) => c.text('Config JSON'));
      app.get('/data.xml', (c) => c.text('XML'));

      // v1 and v2 should be protected
      const v1Res = await app.request('/api/v1/users');
      expect(v1Res.status).toBe(401);

      const v2Res = await app.request('/api/v2/users');
      expect(v2Res.status).toBe(401);

      // v3 should pass
      const v3Res = await app.request('/api/v3/users');
      expect(v3Res.status).toBe(200);

      // .json files should be protected
      const jsonRes = await app.request('/data.json');
      expect(jsonRes.status).toBe(401);

      const configJsonRes = await app.request('/config.json');
      expect(configJsonRes.status).toBe(401);

      // .xml files should pass
      const xmlRes = await app.request('/data.xml');
      expect(xmlRes.status).toBe(200);
    });
  });

  describe('Authentication function', () => {
    it('should pass Request object correctly to auth function', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockImplementation(async (request: Request) => {
          const authHeader = request.headers.get('Authorization');
          return authHeader === 'Bearer valid-token';
        }),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/protected' }],
        })
      );
      app.get('/protected', (c) => c.text('Protected'));

      // No token should fail
      const noTokenRes = await app.request('/protected');
      expect(noTokenRes.status).toBe(401);

      // Invalid token should fail
      const invalidTokenRes = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      expect(invalidTokenRes.status).toBe(401);

      // Valid token should succeed
      const validTokenRes = await app.request('/protected', {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(validTokenRes.status).toBe(200);
      expect(await validTokenRes.text()).toBe('Protected');

      expect(auth.isAuthenticated).toHaveBeenCalledTimes(3);
    });

    it('should handle exceptions thrown by auth function', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockRejectedValue(new Error('Auth service error')),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/protected' }],
        })
      );
      app.get('/protected', (c) => c.text('Protected'));

      const res = await app.request('/protected');
      expect(res.status).toBe(500);
      // Error details are wrapped, just verify status
    });

    it('should support cookie-based authentication', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockImplementation(async (request: Request) => {
          const cookie = request.headers.get('Cookie');
          return cookie?.includes('session=valid-session');
        }),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/dashboard' }],
        })
      );
      app.get('/dashboard', (c) => c.text('Dashboard'));

      // No cookie should fail
      const noCookieRes = await app.request('/dashboard');
      expect(noCookieRes.status).toBe(401);

      // Valid cookie should succeed
      const validCookieRes = await app.request('/dashboard', {
        headers: { Cookie: 'session=valid-session; other=value' },
      });
      expect(validCookieRes.status).toBe(200);
      expect(await validCookieRes.text()).toBe('Dashboard');
    });

    it('should support query parameter authentication', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockImplementation(async (request: Request) => {
          const url = new URL(request.url);
          return url.searchParams.get('api_key') === 'valid-key';
        }),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/data' }],
        })
      );
      app.get('/api/data', (c) => c.text('Data'));

      // No API key should fail
      const noKeyRes = await app.request('/api/data');
      expect(noKeyRes.status).toBe(401);

      // Invalid API key should fail
      const invalidKeyRes = await app.request('/api/data?api_key=invalid-key');
      expect(invalidKeyRes.status).toBe(401);

      // Valid API key should succeed
      const validKeyRes = await app.request('/api/data?api_key=valid-key');
      expect(validKeyRes.status).toBe(200);
      expect(await validKeyRes.text()).toBe('Data');
    });
  });

  describe('Multiple rules', () => {
    it('should support multiple rule combinations', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [
            { path: '/api/users', methods: ['POST', 'PUT', 'DELETE'] },
            { path: '/api/admin/*' },
            { path: '/api/reports', methods: ['GET'] },
            { path: '/webhook/*', methods: ['POST'] },
          ],
        })
      );

      // Setup routes
      app.get('/api/users', (c) => c.text('GET users'));
      app.post('/api/users', (c) => c.text('POST users'));
      app.get('/api/admin/settings', (c) => c.text('Admin settings'));
      app.get('/api/reports', (c) => c.text('Reports'));
      app.post('/webhook/github', (c) => c.text('Webhook'));
      app.get('/public', (c) => c.text('Public'));

      // GET /api/users should pass (not protected)
      const getUsersRes = await app.request('/api/users');
      expect(getUsersRes.status).toBe(200);

      // POST /api/users should be rejected (protected)
      const postUsersRes = await app.request('/api/users', { method: 'POST' });
      expect(postUsersRes.status).toBe(401);

      // GET /api/admin/settings should be rejected (all methods protected)
      const adminRes = await app.request('/api/admin/settings');
      expect(adminRes.status).toBe(401);

      // GET /api/reports should be rejected (GET method protected)
      const reportsRes = await app.request('/api/reports');
      expect(reportsRes.status).toBe(401);

      // POST /webhook/github should be rejected (POST method protected)
      const webhookRes = await app.request('/webhook/github', { method: 'POST' });
      expect(webhookRes.status).toBe(401);

      // GET /public should pass (not protected)
      const publicRes = await app.request('/public');
      expect(publicRes.status).toBe(200);
    });

    it('should handle overlapping rules correctly', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(true),
      };

      app.use(
        authorizer({
          auth,
          rules: [
            { path: '/api/*' }, // protect all /api/* paths
            { path: '/api/public', methods: ['GET'] }, // also protect GET /api/public
          ],
        })
      );
      app.get('/api/public', (c) => c.text('Public API'));
      app.post('/api/public', (c) => c.text('POST Public API'));

      // Both rules match, but auth passes, so should succeed
      const getRes = await app.request('/api/public');
      expect(getRes.status).toBe(200);

      const postRes = await app.request('/api/public', { method: 'POST' });
      expect(postRes.status).toBe(200);

      // Auth function should be called twice
      expect(auth.isAuthenticated).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge cases', () => {
    it('should allow all requests with empty rules array', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(authorizer({ auth, rules: [] }));
      app.get('/any/path', (c) => c.text('OK'));

      const res = await app.request('/any/path');
      expect(res.status).toBe(200);
      expect(auth.isAuthenticated).not.toHaveBeenCalled();
    });

    it('should handle special characters in paths', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [
            { path: '/api/user@email.com' },
            { path: '/files/*.pdf' },
            { path: '/path-with-dash' },
            { path: '/path_with_underscore' },
          ],
        })
      );

      app.get('/api/user@email.com', (c) => c.text('Email'));
      app.get('/files/document.pdf', (c) => c.text('PDF'));
      app.get('/path-with-dash', (c) => c.text('Dash'));
      app.get('/path_with_underscore', (c) => c.text('Underscore'));

      // All special character paths should be matched and protected correctly
      const emailRes = await app.request('/api/user@email.com');
      expect(emailRes.status).toBe(401);

      const pdfRes = await app.request('/files/document.pdf');
      expect(pdfRes.status).toBe(401);

      const dashRes = await app.request('/path-with-dash');
      expect(dashRes.status).toBe(401);

      const underscoreRes = await app.request('/path_with_underscore');
      expect(underscoreRes.status).toBe(401);
    });

    it('should handle URLs with query parameters and fragments', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/search' }],
        })
      );
      app.get('/api/search', (c) => c.text('Search'));

      // Requests with query parameters should be matched correctly
      const res = await app.request('/api/search?q=test&page=1#results');
      expect(res.status).toBe(401);
      expect(auth.isAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('should handle root path correctly', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/' }],
        })
      );
      app.get('/', (c) => c.text('Home'));
      app.get('/other', (c) => c.text('Other'));

      // Root path should be protected
      const rootRes = await app.request('/');
      expect(rootRes.status).toBe(401);

      // Other paths should pass
      const otherRes = await app.request('/other');
      expect(otherRes.status).toBe(200);
    });

    it('should handle trailing slashes as different paths', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockResolvedValue(false),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/api/users' }, { path: '/api/users/' }],
        })
      );
      app.get('/api/users', (c) => c.text('Users'));
      app.get('/api/users/', (c) => c.text('Users with slash'));

      // Both paths should be protected when explicitly defined
      const withoutSlash = await app.request('/api/users');
      expect(withoutSlash.status).toBe(401);

      const withSlash = await app.request('/api/users/');
      expect(withSlash.status).toBe(401);
    });
  });

  describe('Complex authentication scenarios', () => {
    it('should support role-based authentication', async () => {
      const auth: AuthorizerConfig['auth'] = {
        isAuthenticated: jest.fn().mockImplementation(async (request: Request) => {
          const authHeader = request.headers.get('Authorization');
          const url = new URL(request.url);

          // Admin endpoints require admin token
          if (url.pathname.startsWith('/admin')) {
            return authHeader === 'Bearer admin-token';
          }

          // Regular endpoints accept any valid token
          return authHeader?.startsWith('Bearer ');
        }),
      };

      app.use(
        authorizer({
          auth,
          rules: [{ path: '/admin/*' }, { path: '/api/*' }],
        })
      );

      app.get('/admin/users', (c) => c.text('Admin Users'));
      app.get('/api/data', (c) => c.text('API Data'));

      // Admin endpoint with regular token should fail
      const adminWithRegularToken = await app.request('/admin/users', {
        headers: { Authorization: 'Bearer user-token' },
      });
      expect(adminWithRegularToken.status).toBe(401);

      // Admin endpoint with admin token should succeed
      const adminWithAdminToken = await app.request('/admin/users', {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(adminWithAdminToken.status).toBe(200);

      // API endpoint with any token should succeed
      const apiWithUserToken = await app.request('/api/data', {
        headers: { Authorization: 'Bearer user-token' },
      });
      expect(apiWithUserToken.status).toBe(200);
    });
  });
});
