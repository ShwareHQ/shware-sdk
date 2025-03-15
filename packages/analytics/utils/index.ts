const prefix = 'Invariant failed';
export function invariant(condition: any, message?: string | (() => string)): asserts condition {
  if (condition) return;
  const provided: string | undefined = typeof message === 'function' ? message() : message;
  const value: string = provided ? `${prefix}: ${provided}` : prefix;
  throw new Error(value);
}

export interface TokenBucketOptions {
  rate: number;
  capacity: number;
  requested: number;
}

export class TokenBucket {
  readonly rate: number;
  readonly capacity: number;
  readonly requested: number;
  private readonly timer: number | NodeJS.Timeout;
  private tokens: any;

  constructor({ rate, capacity, requested }: TokenBucketOptions) {
    invariant(rate > 0, 'rate must be greater than 0');
    invariant(capacity > 0, 'capacity must be greater than 0');
    invariant(requested > 0, 'requested must be greater than 0');
    invariant(requested <= capacity, 'requested must be less than or equal to capacity');
    this.rate = rate;
    this.capacity = capacity;
    this.requested = requested;
    this.tokens = capacity;
    this.timer = setInterval(() => {
      if (this.tokens < this.capacity) {
        const tokens = this.tokens + this.rate;
        this.tokens = Math.min(tokens, this.capacity);
      }
    }, 1000);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async removeTokens(): Promise<number> {
    while (this.tokens < this.requested) {
      const ms = Math.ceil((1000 * (this.requested - this.tokens)) / this.rate);
      await this.wait(ms);
    }
    this.tokens -= this.requested;
    return this.tokens;
  }

  destroy() {
    clearInterval(this.timer);
  }
}
