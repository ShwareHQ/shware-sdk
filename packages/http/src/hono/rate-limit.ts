import type { Context, MiddlewareHandler } from 'hono';
import { Details } from '../error/detail';
import { Status } from '../error/status';
import { geolocation } from './geolocation';

export interface KV {
  setItem(key: string, value: string, expiresIn?: number): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

interface TokenBucketState {
  tokens: number;
  lastRefillTime: number;
}

export interface RateLimitOptions {
  kv: KV;
  rate: number;
  capacity: number;
  requested?: number;
  keyPrefix?: string;
  expiresIn?: number;
  getIdentifier?: (c: Context) => string | undefined;
  onRateLimited?: (c: Context, retryAfter: number) => Response | Promise<Response>;
  skip?: (c: Context) => boolean | Promise<boolean>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  reset: number;
  retryAfter?: number;
}

function calculateTokens(
  state: TokenBucketState | null,
  capacity: number,
  rate: number,
  now: number
): { tokens: number; lastRefillTime: number } {
  if (!state) {
    return { tokens: capacity, lastRefillTime: now };
  }

  const elapsed = (now - state.lastRefillTime) / 1000;
  const tokensToAdd = elapsed * rate;
  const newTokens = Math.min(capacity, state.tokens + tokensToAdd);

  return {
    tokens: newTokens,
    lastRefillTime: now,
  };
}

function calculateResetTime(currentTokens: number, capacity: number, rate: number): number {
  if (currentTokens >= capacity) return 0;
  return Math.ceil((capacity - currentTokens) / rate);
}

function calculateRetryAfter(currentTokens: number, requested: number, rate: number): number {
  if (currentTokens >= requested) return 0;
  return Math.ceil((requested - currentTokens) / rate);
}

export async function checkRateLimit(
  kv: KV,
  identifier: string,
  options: {
    rate: number;
    capacity: number;
    requested?: number;
    keyPrefix?: string;
    expiresIn?: number;
  }
): Promise<RateLimitResult> {
  const {
    rate,
    capacity,
    requested = 1,
    keyPrefix = 'rate-limit:',
    expiresIn = Math.max(3600, Math.ceil((capacity / rate) * 2)),
  } = options;

  const key = `${keyPrefix}${identifier}`;
  const now = Date.now();

  const stateStr = await kv.getItem(key);
  const state: TokenBucketState | null = stateStr ? JSON.parse(stateStr) : null;

  const { tokens: currentTokens, lastRefillTime } = calculateTokens(state, capacity, rate, now);

  const allowed = currentTokens >= requested;
  const newTokens = allowed ? currentTokens - requested : currentTokens;

  const newState: TokenBucketState = { tokens: newTokens, lastRefillTime };
  await kv.setItem(key, JSON.stringify(newState), expiresIn);

  const result: RateLimitResult = {
    allowed,
    remaining: Math.floor(Math.max(0, newTokens)),
    limit: capacity,
    reset: calculateResetTime(newTokens, capacity, rate),
  };

  if (!allowed) {
    result.retryAfter = calculateRetryAfter(currentTokens, requested, rate);
  }

  return result;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const {
    kv,
    rate,
    capacity,
    requested = 1,
    keyPrefix = 'rate-limit:',
    expiresIn = Math.max(3600, Math.ceil((capacity / rate) * 2)),
    getIdentifier,
    onRateLimited,
    skip,
  } = options;

  return async (c, next) => {
    if (skip && (await skip(c))) {
      return next();
    }

    const identifier = getIdentifier ? getIdentifier(c) : geolocation(c).ip_address;
    if (!identifier) return next();

    const result = await checkRateLimit(kv, identifier, {
      rate,
      capacity,
      requested,
      keyPrefix,
      expiresIn,
    });

    c.header('X-RateLimit-Limit', String(result.limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.reset));

    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter ?? 1));
      if (onRateLimited) return onRateLimited(c, result.retryAfter ?? 1);

      const details = Details.new()
        .errorInfo({ reason: 'RATE_LIMIT_EXCEEDED' })
        .retryInfo({ retryDelay: result.retryAfter ?? 1 });

      const message = 'Rate limit exceeded. Please try again later.';
      return Status.resourceExhausted(message).response(details);
    }

    return next();
  };
}
