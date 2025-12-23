import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { csrf } from '../csrf';
import { type Env, errorHandler } from '../handler';

describe('CSRF Protection', () => {
  let app: Hono<Env>;

  beforeEach(() => {
    app = new Hono();
    app.onError(errorHandler);
  });

  it('should allow GET requests without CSRF token', async () => {
    app.use(csrf());
    app.get('/test', (c) => c.text('OK'));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });

  it('should allow HEAD requests without CSRF token', async () => {
    app.use(csrf());
    app.all('/test', (c) => c.text('OK'));

    const res = await app.request('/test', { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('should allow OPTIONS requests without CSRF token', async () => {
    app.use(csrf());
    app.options('/test', (c) => c.text('OK'));

    const res = await app.request('/test', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
  });

  it('should reject POST requests without CSRF token', async () => {
    app.use(csrf());
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('should reject POST requests with mismatched tokens', async () => {
    app.use(csrf());
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'X-XSRF-TOKEN': 'header-token', Cookie: 'XSRF-TOKEN=cookie-token' },
    });
    expect(res.status).toBe(403);
  });

  it('should allow POST requests with matching tokens', async () => {
    app.use(csrf());
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'X-XSRF-TOKEN': 'matching-token',
        Cookie: 'XSRF-TOKEN=matching-token',
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });

  it('should use custom cookie and header names', async () => {
    app.use(csrf({ cookieName: 'csrf-token', headerName: 'X-CSRF-Token' }));
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': 'test-token',
        Cookie: 'csrf-token=test-token',
      },
    });
    expect(res.status).toBe(200);
  });

  it('should ignore specified paths', async () => {
    app.use(csrf({ ignores: [{ path: '/webhook/*', methods: ['POST'] }] }));
    app.post('/webhook/stripe', (c) => c.text('OK'));
    app.post('/api/data', (c) => c.text('OK'));

    // Ignored path should work without CSRF token
    const webhookRes = await app.request('/webhook/stripe', { method: 'POST' });
    expect(webhookRes.status).toBe(200);

    // Non-ignored path should require CSRF token
    const apiRes = await app.request('/api/data', { method: 'POST' });
    expect(apiRes.status).toBe(403);
  });

  it('should ignore all methods for a path when methods not specified', async () => {
    app.use(csrf({ ignores: [{ path: '/auth/apple/callback' }] }));
    app.post('/auth/apple/callback', (c) => c.text('OK'));
    app.put('/auth/apple/callback', (c) => c.text('OK'));

    const postRes = await app.request('/auth/apple/callback', { method: 'POST' });
    expect(postRes.status).toBe(200);

    const putRes = await app.request('/auth/apple/callback', { method: 'PUT' });
    expect(putRes.status).toBe(200);
  });

  it('should handle empty tokens safely', async () => {
    app.use(csrf());
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'X-XSRF-TOKEN': '', Cookie: 'XSRF-TOKEN=' },
    });
    expect(res.status).toBe(403);
  });

  it('should handle missing cookie', async () => {
    app.use(csrf());
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'X-XSRF-TOKEN': 'token' },
    });
    expect(res.status).toBe(403);
  });

  it('should handle missing header', async () => {
    app.use(csrf());
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', {
      method: 'POST',
      headers: { Cookie: 'XSRF-TOKEN=token' },
    });
    expect(res.status).toBe(403);
  });

  it('should use custom error message', async () => {
    app.use(csrf({ errorMessage: 'Custom CSRF error' }));
    app.post('/test', (c) => c.text('OK'));

    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toBe('Custom CSRF error');
  });

  it('should work with custom safe methods', async () => {
    app.use(csrf({ safeMethods: ['GET'] }));
    app.all('/test', (c) => c.text('OK'));

    // HEAD is no longer safe, should require CSRF token
    const res = await app.request('/test', { method: 'HEAD' });
    expect(res.status).toBe(403);
  });

  it('should handle complex ignore patterns', async () => {
    app.use(
      csrf({
        ignores: [
          { path: '/api/v1/*', methods: ['GET', 'POST'] },
          { path: '/api/v2/*', methods: ['POST'] },
          { path: '/public/*' }, // All methods
        ],
      })
    );

    app.get('/api/v1/users', (c) => c.text('OK'));
    app.post('/api/v1/users', (c) => c.text('OK'));
    app.put('/api/v1/users', (c) => c.text('OK'));
    app.post('/api/v2/users', (c) => c.text('OK'));
    app.get('/api/v2/users', (c) => c.text('OK'));
    app.post('/public/data', (c) => c.text('OK'));

    // Ignored GET and POST for /api/v1/*
    let res = await app.request('/api/v1/users', { method: 'GET' });
    expect(res.status).toBe(200);

    res = await app.request('/api/v1/users', { method: 'POST' });
    expect(res.status).toBe(200);

    // PUT not ignored for /api/v1/*
    res = await app.request('/api/v1/users', { method: 'PUT' });
    expect(res.status).toBe(403);

    // Only POST ignored for /api/v2/*
    res = await app.request('/api/v2/users', { method: 'POST' });
    expect(res.status).toBe(200);

    // GET not ignored for /api/v2/* (but GET is safe by default)
    res = await app.request('/api/v2/users', { method: 'GET' });
    expect(res.status).toBe(200);

    // All methods ignored for /public/*
    res = await app.request('/public/data', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  describe('Origin bypass', () => {
    it('should allow requests from configured origins', async () => {
      app.use(csrf({ origin: ['https://example.com', 'https://trusted.com'] }));
      app.post('/test', (c) => c.text('OK'));

      // Request from allowed origin should work without CSRF token
      const res = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'https://example.com' },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('OK');
    });

    it('should allow requests from any configured origin', async () => {
      app.use(csrf({ origin: ['https://example.com', 'https://trusted.com'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'https://trusted.com' },
      });
      expect(res.status).toBe(200);
    });

    it('should reject requests from non-configured origins', async () => {
      app.use(csrf({ origin: ['https://example.com'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'https://malicious.com' },
      });
      expect(res.status).toBe(403);
    });

    it('should reject requests without origin header', async () => {
      app.use(csrf({ origin: ['https://example.com'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('should handle empty origin list', async () => {
      app.use(csrf({ origin: [] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'https://example.com' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Sec-Fetch-Site bypass', () => {
    it('should allow requests with configured sec-fetch-site values', async () => {
      app.use(csrf({ secFetchSite: ['same-origin', 'same-site'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'same-origin' },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('OK');
    });

    it('should allow requests with any configured sec-fetch-site value', async () => {
      app.use(csrf({ secFetchSite: ['same-origin', 'same-site', 'cross-origin'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'cross-origin' },
      });
      expect(res.status).toBe(200);
    });

    it('should reject requests with non-configured sec-fetch-site values', async () => {
      app.use(csrf({ secFetchSite: ['same-origin'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'same-site' },
      });
      expect(res.status).toBe(403);
    });

    it('should reject requests without sec-fetch-site header', async () => {
      app.use(csrf({ secFetchSite: ['same-origin'] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('should handle all valid sec-fetch-site values', async () => {
      app.use(csrf({ secFetchSite: ['same-origin', 'same-site', 'none', 'cross-origin'] }));
      app.post('/test', (c) => c.text('OK'));

      const validValues = ['same-origin', 'same-site', 'none', 'cross-origin'];

      for (const value of validValues) {
        const res = await app.request('/test', {
          method: 'POST',
          headers: { 'Sec-Fetch-Site': value },
        });
        expect(res.status).toBe(200);
      }
    });

    it('should handle empty sec-fetch-site list', async () => {
      app.use(csrf({ secFetchSite: [] }));
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'same-origin' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Combined origin and sec-fetch-site bypass', () => {
    it('should allow requests matching either origin or sec-fetch-site', async () => {
      app.use(
        csrf({
          origin: ['https://example.com'],
          secFetchSite: ['same-site'],
        })
      );
      app.post('/test', (c) => c.text('OK'));

      // Should work with matching origin
      let res = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'https://example.com' },
      });
      expect(res.status).toBe(200);

      // Should work with matching sec-fetch-site
      res = await app.request('/test', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'same-site' },
      });
      expect(res.status).toBe(200);
    });

    it('should reject requests matching neither origin nor sec-fetch-site', async () => {
      app.use(
        csrf({
          origin: ['https://example.com'],
          secFetchSite: ['same-origin'],
        })
      );
      app.post('/test', (c) => c.text('OK'));

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Origin: 'https://malicious.com',
          'Sec-Fetch-Site': 'cross-origin',
        },
      });
      expect(res.status).toBe(403);
    });

    it('should work with origin, sec-fetch-site and ignore rules combined', async () => {
      app.use(
        csrf({
          origin: ['https://example.com'],
          secFetchSite: ['same-site'],
          ignores: [{ path: '/webhook/*', methods: ['POST'] }],
        })
      );

      app.post('/test', (c) => c.text('OK'));
      app.post('/webhook/stripe', (c) => c.text('OK'));
      app.post('/api/data', (c) => c.text('OK'));

      // Should work with origin bypass
      let res = await app.request('/test', {
        method: 'POST',
        headers: { Origin: 'https://example.com' },
      });
      expect(res.status).toBe(200);

      // Should work with sec-fetch-site bypass
      res = await app.request('/test', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'same-site' },
      });
      expect(res.status).toBe(200);

      // Should work with ignore rule
      res = await app.request('/webhook/stripe', { method: 'POST' });
      expect(res.status).toBe(200);

      // Should fail without any bypass
      res = await app.request('/api/data', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });
});
