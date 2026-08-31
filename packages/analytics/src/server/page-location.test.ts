import { describe, expect, it } from 'vitest';
import { tagsSchema } from '../schema/index';
import type { TrackTags } from '../track/types';
import { pageLocation } from './page-location';

const tags = (extra: Partial<TrackTags>): TrackTags => extra;

/**
 * `source_url` became `page_location` in 7.0.0, but a backend upgrades in one deploy and the
 * browser bundles talking to it do not. These pin the window: an event from a tab opened
 * before the deploy still has to reach Meta and OpenAI with a URL on it.
 */
describe('pageLocation', () => {
  it('reads the current name', () => {
    expect(pageLocation(tags({ page_location: 'https://example.com/new' }))).toBe(
      'https://example.com/new'
    );
  });

  it('falls back to the name clients used before 7.0.0', () => {
    expect(pageLocation(tags({ source_url: 'https://example.com/old' }))).toBe(
      'https://example.com/old'
    );
  });

  it('prefers the current name when a client sends both', () => {
    const both = tags({
      page_location: 'https://example.com/new',
      source_url: 'https://example.com/old',
    });
    expect(pageLocation(both)).toBe('https://example.com/new');
  });

  it('is undefined when neither is present', () => {
    expect(pageLocation(tags({}))).toBeUndefined();
  });

  /**
   * The other half of the fallback, and the half that fails silently: `tagsSchema` strips
   * keys it does not declare, so an undeclared `source_url` would be gone before any sender
   * could read it and this whole transition would be a no-op.
   */
  it('survives tag validation, so a sender can still see it', () => {
    const parsed = tagsSchema.parse({ source_url: 'https://example.com/old' }) as TrackTags;
    expect(pageLocation(parsed)).toBe('https://example.com/old');
  });
});
