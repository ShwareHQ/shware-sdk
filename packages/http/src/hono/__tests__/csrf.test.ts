import { Hono } from 'hono';
import { csrf } from '../csrf';
import { errorHandler, type Env } from '../handler';

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
});
