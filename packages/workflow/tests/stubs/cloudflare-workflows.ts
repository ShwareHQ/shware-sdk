/** Stand-in for the `cloudflare:workflows` built-in (see cloudflare-workers.ts); wired up in vitest.config.ts. */
export class NonRetryableError extends Error {
  constructor(message: string, name = 'NonRetryableError') {
    super(message);
    this.name = name;
  }
}
