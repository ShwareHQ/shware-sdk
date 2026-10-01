import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withinWindow } from './event-window';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number, name = 'purchase') => ({
  name,
  created_at: new Date(NOW + offsetMs).toISOString(),
});

describe('withinWindow', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('keeps what is inside a 7-day window and leaves out, with a warning, what is not', () => {
    const fresh = at(-DAY);
    const stale = at(-7 * DAY, 'sign_up');
    expect(withinWindow('meta', [fresh, stale], NOW)).toEqual([fresh]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 meta conversion(s)'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sign_up'));
  });

  it('gives LinkedIn its 90 days', () => {
    const month = at(-30 * DAY);
    expect(withinWindow('linkedin', [month, at(-91 * DAY)], NOW)).toEqual([month]);
  });

  it('holds OpenAI to 10 minutes ahead, and lets the others take a skewed future time', () => {
    const ahead = at(11 * 60 * 1000);
    expect(withinWindow('openai', [ahead], NOW)).toEqual([]);
    expect(withinWindow('reddit', [ahead], NOW)).toEqual([ahead]);
  });

  it('leaves out an unparseable time, and warns about nothing when all are kept', () => {
    expect(withinWindow('microsoft', [{ name: 'x', created_at: 'nope' }], NOW)).toEqual([]);
    warn.mockClear();
    withinWindow('microsoft', [at(0)], NOW);
    expect(warn).not.toHaveBeenCalled();
  });
});
