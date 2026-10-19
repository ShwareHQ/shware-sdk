import { afterEach, describe, expect, test } from 'vitest';
import { stepRetry } from '../src/aws/engine-step';
import { fromResponse, isFunctionUrlEvent, toRequest } from '../src/aws/function-url';
import { type EmailMessage, EmailSender } from '../src/email-sender';
import type { OutboundMessage } from '../src/engine/ports';
import { CloudflareEmailError, cloudflareEmailTransport } from '../src/transports/cloudflare-email';
import { SesSendError, sesAddress, sesEmailTransport } from '../src/transports/ses';
import { signRequest } from '../src/transports/sigv4';

/**
 * The email transports — SES over a SigV4-signed fetch, Cloudflare Email by binding or REST —
 * and the shared sender in front of them: the same finished email whatever the provider.
 */

const email: EmailMessage = {
  from: { email: 'hi@acme.test', name: 'Acme' },
  to: 'ada@example.com',
  replyTo: 'support@acme.test',
  subject: 'Welcome aboard',
  html: '<p>Hi</p>',
  idempotencyKey: 'inst:0',
};

function recordingFetch(response: () => Response) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('signRequest (SigV4)', () => {
  // The AWS SigV4 test suite's credentials and clock
  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const base = {
    credentials,
    region: 'us-east-1',
    service: 'service',
    datetime: '20150830T123600Z',
  };

  test('matches the AWS test suite: get-vanilla', async () => {
    const headers = await signRequest({
      ...base,
      method: 'GET',
      url: 'https://example.amazonaws.com/',
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    );
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    // fetch sets Host from the URL itself
    expect(headers.host).toBeUndefined();
  });

  test('matches the AWS test suite: query parameters sorted', async () => {
    const headers = await signRequest({
      ...base,
      method: 'GET',
      url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
    });
    expect(headers.authorization).toMatch(
      /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/
    );
  });

  test('an SES call with a session token, as an independent implementation signs it', async () => {
    // Expected value computed with Python's hashlib/hmac over the same canonical request
    const headers = await signRequest({
      method: 'POST',
      url: 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
      credentials: { ...credentials, sessionToken: 'tok' },
      region: 'us-east-1',
      service: 'ses',
      datetime: '20261019T120000Z',
    });
    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-amz-date': '20261019T120000Z',
      'x-amz-security-token': 'tok',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261019/us-east-1/ses/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=14b7752621aa0bf844a0a176e3f3cbdcf5be8a2b6c13ffa1c2bb3ed729ba7ab4',
    });
  });
});

describe('signRequest canonicalization', () => {
  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const base = {
    credentials,
    region: 'us-east-1',
    service: 'service',
    datetime: '20150830T123600Z',
  };
  const signature = async (url: string, headers?: Record<string, string>) =>
    (
      await signRequest({
        ...base,
        method: 'GET',
        url,
        ...(headers === undefined ? {} : { headers }),
      })
    ).authorization.split('Signature=')[1];

  test('query names and values are RFC 3986 encoded and sorted by name, then value', async () => {
    // Expected from Python: urllib.parse.quote(safe='-_.~') over the sorted pairs
    expect(await signature("https://example.amazonaws.com/?b=x%20y!*'()&a=2&a=1")).toBe(
      '82bc5badeb02f346c4be0f4a1f780caa3fefc39879035bb6c61041a93c24a7e0'
    );
  });

  test('a literal + in the query is signed as %2B, not as a space', async () => {
    const plus = await signature('https://example.amazonaws.com/?a=1+2');
    expect(plus).toBe(await signature('https://example.amazonaws.com/?a=1%2B2'));
    expect(plus).not.toBe(await signature('https://example.amazonaws.com/?a=1%202'));
  });

  test('header values are trimmed and inner whitespace collapsed; names are case-insensitive', async () => {
    expect(await signature('https://example.amazonaws.com/', { 'X-Test': '  a    b ' })).toBe(
      await signature('https://example.amazonaws.com/', { 'x-test': 'a b' })
    );
  });

  test('the date defaults to now in the SigV4 format', async () => {
    const headers = await signRequest({
      credentials,
      region: 'us-east-1',
      service: 'ses',
      method: 'POST',
      url: 'https://email.us-east-1.amazonaws.com/',
    });
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers.authorization).toContain(`/${headers['x-amz-date'].slice(0, 8)}/us-east-1/ses/`);
  });
});

describe('sesEmailTransport', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  test('signs a v2 SendEmail with the session token and maps the email onto it', async () => {
    const { calls, fetchImpl } = recordingFetch(
      () => new Response(JSON.stringify({ MessageId: 'ses-1' }), { status: 200 })
    );
    const transport = sesEmailTransport({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret', sessionToken: 'tok' },
      configurationSetName: 'journeys',
      fetch: fetchImpl,
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: 'ses-1' });
    const [call] = calls;
    expect(call.url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
    expect(call.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-east-1\/ses\/aws4_request/
    );
    expect(call.headers.get('x-amz-security-token')).toBe('tok');
    expect(JSON.parse(call.body)).toEqual({
      FromEmailAddress: 'Acme <hi@acme.test>',
      Destination: { ToAddresses: ['ada@example.com'] },
      ReplyToAddresses: ['support@acme.test'],
      Content: {
        Simple: {
          Subject: { Data: 'Welcome aboard', Charset: 'UTF-8' },
          Body: { Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' } },
        },
      },
      ConfigurationSetName: 'journeys',
    });
  });

  test('reads the execution role from the environment at send time, not at construction', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    const { calls, fetchImpl } = recordingFetch(() => new Response('{}', { status: 200 }));
    const transport = sesEmailTransport({ region: 'eu-west-1', fetch: fetchImpl });
    await expect(transport.send(email)).rejects.toThrow(/no credentials/);
    process.env.AWS_ACCESS_KEY_ID = 'ROLE1';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.AWS_SESSION_TOKEN = 'rotated';
    await transport.send(email);
    expect(calls[0].headers.get('authorization')).toContain('Credential=ROLE1/');
    expect(calls[0].headers.get('x-amz-security-token')).toBe('rotated');
  });

  test('a provider is asked on every send', async () => {
    let n = 0;
    const { calls, fetchImpl } = recordingFetch(() => new Response('{}', { status: 200 }));
    const transport = sesEmailTransport({
      region: 'us-east-1',
      credentials: async () => ({ accessKeyId: `KEY${++n}`, secretAccessKey: 's' }),
      fetch: fetchImpl,
    });
    await transport.send(email);
    await transport.send(email);
    expect(
      calls.map((c) => c.headers.get('authorization')?.match(/Credential=(\w+)\//)?.[1])
    ).toEqual(['KEY1', 'KEY2']);
  });

  test('an SES refusal throws with its error type', async () => {
    const { fetchImpl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ message: 'Email address is not verified.' }), {
          status: 400,
          headers: { 'x-amzn-ErrorType': 'MessageRejected:http://internal' },
        })
    );
    const transport = sesEmailTransport({
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      fetch: fetchImpl,
    });
    const error = await transport.send(email).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SesSendError);
    expect(error).toMatchObject({ status: 400, type: 'MessageRejected' });
  });

  test('a non-JSON error body is reported as is; a success without MessageId is still a success', async () => {
    let answer = new Response('<html>Bad Gateway</html>', { status: 502 });
    const { calls, fetchImpl } = recordingFetch(() => answer);
    const transport = sesEmailTransport({
      region: 'us-east-1',
      endpoint: 'https://ses.proxy.test/',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      fetch: fetchImpl,
    });
    await expect(transport.send(email)).rejects.toThrow(/\(502\): <html>Bad Gateway/);
    // The configured endpoint, its trailing slash dropped
    expect(calls[0].url).toBe('https://ses.proxy.test/v2/email/outbound-emails');
    answer = new Response('', { status: 200 });
    expect(await transport.send(email)).toEqual({});
  });

  test('no Reply-To when the template names none', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response('{}', { status: 200 }));
    const transport = sesEmailTransport({
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      fetch: fetchImpl,
    });
    const { replyTo: _replyTo, ...withoutReplyTo } = email;
    await transport.send(withoutReplyTo);
    expect(JSON.parse(calls[0].body)).not.toHaveProperty('ReplyToAddresses');
    expect(calls[0].headers.get('x-amz-security-token')).toBeNull();
  });

  test('display names are quoted or encoded the way SES requires', () => {
    expect(sesAddress('a@b.c')).toBe('a@b.c');
    expect(sesAddress({ email: 'a@b.c', name: 'Acme, Inc.' })).toBe('"Acme, Inc." <a@b.c>');
    expect(sesAddress({ email: 'a@b.c', name: '艾克米' })).toBe(
      `=?UTF-8?B?${Buffer.from('艾克米').toString('base64')}?= <a@b.c>`
    );
  });
});

describe('cloudflareEmailTransport', () => {
  test('the binding gets the finished email, idempotency key included', async () => {
    const received: unknown[] = [];
    const transport = cloudflareEmailTransport({
      binding: {
        async send(message) {
          received.push(message);
          return { messageId: 'cf-1' };
        },
      },
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: 'cf-1' });
    expect(received).toEqual([email]);
  });

  test('the REST API from anywhere else: account URL, bearer token, snake_case reply_to', async () => {
    const { calls, fetchImpl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ success: true, errors: [], result: { message_id: 'm1' } }), {
          status: 200,
        })
    );
    const transport = cloudflareEmailTransport({
      accountId: 'acc',
      apiToken: 'cf-token',
      fetch: fetchImpl,
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: 'm1' });
    expect(calls[0].url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/email/sending/send'
    );
    expect(calls[0].headers.get('authorization')).toBe('Bearer cf-token');
    expect(JSON.parse(calls[0].body)).toEqual({
      from: 'Acme <hi@acme.test>',
      to: 'ada@example.com',
      reply_to: 'support@acme.test',
      subject: 'Welcome aboard',
      html: '<p>Hi</p>',
    });
  });

  test("a REST refusal throws with Cloudflare's error codes", async () => {
    const { fetchImpl } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({ success: false, errors: [{ code: 10101, message: 'unauthorized' }] }),
          { status: 401 }
        )
    );
    const transport = cloudflareEmailTransport({ accountId: 'a', apiToken: 't', fetch: fetchImpl });
    const error = await transport.send(email).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareEmailError);
    expect(String(error)).toMatch(/10101 unauthorized/);
  });
});

describe('EmailSender', () => {
  const message: OutboundMessage = {
    workflow: 'w',
    instanceId: 'inst',
    nodeId: '0',
    channel: 'email',
    template: 'welcome',
    props: {},
    userId: 'u1',
    recipient: 'ada@example.com',
    idempotencyKey: 'inst:0',
  };

  test('renders, tracks, commits the links, then hands the email to the transport', async () => {
    const order: string[] = [];
    const sent: EmailMessage[] = [];
    const sender = new EmailSender({
      render: async () => ({
        from: 'hi@acme.test',
        replyTo: 'support@acme.test',
        unsubscribeUrl: 'https://acme.test/unsubscribe',
        subject: 'Welcome',
        html: '<body><a href="https://acme.test/unsubscribe">u</a></body>',
      }),
      transport: {
        async send(m) {
          order.push('send');
          sent.push(m);
          return {};
        },
      },
    });
    await sender.send({
      ...message,
      tracking: {
        link: (url, purpose) => `https://t.test/${purpose}?u=${encodeURIComponent(url)}`,
        pixel: 'https://t.test/o.gif',
        commit: async () => {
          order.push('commit');
        },
      },
    });
    expect(order).toEqual(['commit', 'send']);
    expect(sent[0]).toMatchObject({ from: 'hi@acme.test', replyTo: 'support@acme.test' });
    expect(sent[0].html).toContain('https://t.test/unsubscribe?u=');
    expect(sent[0].html).toContain('<img src="https://t.test/o.gif"');
  });
});

describe('stepRetry', () => {
  test('a deterministic refusal is not retried; anything else is, a bounded number of times', () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    expect(stepRetry(named('TemplateValidationError'), 1)).toEqual({ shouldRetry: false });
    expect(stepRetry(named('ContractValidationError'), 1)).toEqual({ shouldRetry: false });
    expect(stepRetry(new Error('socket hang up'), 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 },
    });
    expect(stepRetry(new Error('socket hang up'), 5)).toEqual({
      shouldRetry: true,
      delay: { seconds: 32 },
    });
    expect(stepRetry(new Error('socket hang up'), 6)).toEqual({ shouldRetry: false });
  });
});

describe('Function URL events', () => {
  test('cookies travel both ways', async () => {
    const request = toRequest({
      rawPath: '/',
      cookies: ['a=1', 'b=2'],
      requestContext: { domainName: 'h.test', http: { method: 'GET' } },
    });
    expect(request.headers.get('cookie')).toBe('a=1; b=2');
    const headers = new Headers({ 'content-type': 'text/plain' });
    headers.append('set-cookie', 'x=1');
    headers.append('set-cookie', 'y=2');
    const result = await fromResponse(new Response('ok', { headers }), 'GET');
    expect(result.cookies).toEqual(['x=1', 'y=2']);
    expect(result.headers).toEqual({ 'content-type': 'text/plain' });
  });

  test('a request becomes a fetch Request: query, headers, base64 body', async () => {
    const event = {
      version: '2.0',
      rawPath: '/events',
      rawQueryString: 'a=1&b=2',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: Buffer.from('{"userId":"u1"}').toString('base64'),
      isBase64Encoded: true,
      requestContext: { domainName: 'abc.lambda-url.us-east-1.on.aws', http: { method: 'POST' } },
    };
    expect(isFunctionUrlEvent(event)).toBe(true);
    const request = toRequest(event);
    expect(request.url).toBe('https://abc.lambda-url.us-east-1.on.aws/events?a=1&b=2');
    expect(request.headers.get('authorization')).toBe('Bearer x');
    expect(await request.json()).toEqual({ userId: 'u1' });
  });

  test('a GET or HEAD carries no body', () => {
    const request = toRequest({
      rawPath: '/t/o/x.gif',
      body: 'ignored',
      requestContext: { http: { method: 'HEAD' } },
      headers: { host: 'h.test' },
    });
    expect(request.method).toBe('HEAD');
    expect(request.body).toBeNull();
  });

  test('a binary response (the open pixel) goes back base64; JSON as text; HEAD empty', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const pixel = await fromResponse(
      new Response(gif, { headers: { 'content-type': 'image/gif' } }),
      'GET'
    );
    expect(pixel).toMatchObject({ statusCode: 200, isBase64Encoded: true });
    expect(Buffer.from(pixel.body, 'base64')).toEqual(Buffer.from(gif));

    const body = await fromResponse(
      new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }),
      'POST'
    );
    expect(body).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      isBase64Encoded: false,
    });

    const head = await fromResponse(
      new Response(gif, { headers: { 'content-type': 'image/gif' } }),
      'HEAD'
    );
    expect(head.body).toBe('');
  });

  test('only the Function URL envelope is HTTP: a direct invoke payload is not', () => {
    expect(isFunctionUrlEvent({ type: '$workflow.run', rawPath: '/x' })).toBe(false);
    expect(isFunctionUrlEvent(null)).toBe(false);
  });
});
