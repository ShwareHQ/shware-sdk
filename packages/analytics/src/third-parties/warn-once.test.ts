import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWarnOnce, warnOnce } from './warn-once';

describe('warnOnce', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetWarnOnce();
  });
  afterEach(() => {
    vi.mocked(console.warn).mockRestore();
  });

  it('warns the first time per message and is silent after', () => {
    warnOnce('fbq has not been initialized');
    warnOnce('fbq has not been initialized');
    warnOnce('gtag has not been initialized');
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenNthCalledWith(1, 'fbq has not been initialized');
    expect(console.warn).toHaveBeenNthCalledWith(2, 'gtag has not been initialized');
  });

  it('warns again after a reset', () => {
    warnOnce('uetq has not been initialized');
    resetWarnOnce();
    warnOnce('uetq has not been initialized');
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
