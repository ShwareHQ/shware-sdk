type Interval = 'second' | 'minute' | 'hour' | 'day';

const INTERVAL_MAP: Record<Interval, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export interface TokenBucketOptions {
  rate: number;
  capacity: number;
  requested: number;
  interval?: Interval;
}

export class TokenBucket {
  readonly rate: number;
  readonly capacity: number;
  readonly requested: number;
  private readonly intervalMs: number;
  private readonly timer: number | NodeJS.Timeout;
  private tokens: number;

  constructor({ rate, capacity, requested, interval = 'second' }: TokenBucketOptions) {
    if (rate <= 0) throw new Error('rate must be greater than 0');
    if (capacity <= 0) throw new Error('capacity must be greater than 0');
    if (requested <= 0) throw new Error('requested must be greater than 0');
    if (requested > capacity) throw new Error('requested must be less than or equal to capacity');

    this.rate = rate;
    this.capacity = capacity;
    this.requested = requested;
    this.tokens = capacity;
    this.intervalMs = INTERVAL_MAP[interval];
    this.timer = setInterval(() => {
      if (this.tokens < this.capacity) {
        const tokens = this.tokens + this.rate;
        this.tokens = Math.min(tokens, this.capacity);
      }
    }, this.intervalMs);
    // Refilling must not keep a Node process alive on its own (absent in browsers).
    (this.timer as { unref?: () => void }).unref?.();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async removeTokens(): Promise<number> {
    while (this.tokens < this.requested) {
      const ms = Math.ceil((this.intervalMs * (this.requested - this.tokens)) / this.rate);
      await this.wait(ms);
    }
    this.tokens -= this.requested;
    return this.tokens;
  }

  destroy() {
    clearInterval(this.timer);
  }
}
