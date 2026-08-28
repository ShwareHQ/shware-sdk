// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Link } from '../link/index';

const fetchMock = vi.fn();

async function load() {
  vi.stubGlobal('fetch', fetchMock);
  const { baseOptions, memoryStorage, jsonResponse } = await import('../test/setup');
  const storage = memoryStorage();
  const setup = await import('../setup/index');
  setup.setupAnalytics(baseOptions({ storage }));
  const web = await import('./index');
  // `web` exports its own `storage`; ours goes under a distinct name.
  return { memory: storage, jsonResponse, ...web };
}

function link(partial: Partial<Link>): Link {
  return {
    id: 'l1',
    created_at: '2026-01-01T00:00:00Z',
    name: 'test',
    url: 'x',
    ...partial,
  } as Link;
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getTags', () => {
  it('reports the page it runs on', async () => {
    const { getTags } = await load();
    window.history.replaceState(null, '', '/pricing?q=1');
    document.title = 'Pricing';

    const tags = await getTags();

    expect(tags.page_location).toBe(window.location.href);
    expect(tags.page_location).toContain('/pricing?q=1');
    expect(tags.page_title).toBe('Pricing');
    expect(tags.device_id).toBeTruthy();
    expect(tags.screen_resolution).toMatch(/^\d+x\d+$/);
  });

  it('reads ad click ids from the query string', async () => {
    const { getTags } = await load();
    window.history.replaceState(null, '', '/?gclid=G123&fbclid=F456&utm_source=google');

    const tags = await getTags();

    expect(tags).toMatchObject({ gclid: 'G123', fbclid: 'F456', utm_source: 'google' });
  });

  it('reads the ad identity cookies the server and pixels left behind', async () => {
    const { getTags } = await load();
    document.cookie = '_fbp=fb.1.1700000000000.987654';
    document.cookie = '_fbc=fb.1.1700000000000.CLK1';
    document.cookie = '_rdt_uuid=1700000000000.7c73f2ae-a433-4d7b-9838-f467da98f48e';
    document.cookie = '_rdt_cid=RDT_FROM_COOKIE';
    document.cookie = 'li_fat_id=LI_FROM_COOKIE';

    const tags = await getTags();

    expect(tags).toMatchObject({
      fbp: 'fb.1.1700000000000.987654',
      fbc: 'fb.1.1700000000000.CLK1',
      rdt_uuid: '1700000000000.7c73f2ae-a433-4d7b-9838-f467da98f48e',
      rdt_cid: 'RDT_FROM_COOKIE',
      li_fat_id: 'LI_FROM_COOKIE',
    });

    // A click id in the URL is fresher than the first-party cookie and wins.
    window.history.replaceState(null, '', '/?rdt_cid=RDT_FROM_URL&li_fat_id=LI_FROM_URL');
    const fresh = await getTags();
    expect(fresh.rdt_cid).toBe('RDT_FROM_URL');
    expect(fresh.li_fat_id).toBe('LI_FROM_URL');

    for (const name of ['_fbp', '_fbc', '_rdt_uuid', '_rdt_cid', 'li_fat_id']) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  });

  it('snapshots the page before awaiting the link lookup', async () => {
    const { getTags, jsonResponse } = await load();
    window.history.replaceState(null, '', '/landing?s=abc');
    let resolveLink!: (r: Response) => void;
    fetchMock.mockReturnValue(
      new Promise((r) => {
        resolveLink = r;
      })
    );

    const pending = getTags();
    // The SPA navigates while the link request is in flight.
    window.history.replaceState(null, '', '/next-page');
    resolveLink(jsonResponse(link({ utm_source: 'newsletter' })));
    const tags = await pending;

    expect(tags.page_location).toContain('/landing?s=abc');
    expect(tags.utm_source).toBe('newsletter');
  });

  it('the link outranks the query string for utm params', async () => {
    const { getTags, jsonResponse } = await load();
    window.history.replaceState(null, '', '/?s=abc&utm_source=url-param');
    fetchMock.mockResolvedValue(jsonResponse(link({ utm_source: 'from-link' })));

    expect((await getTags()).utm_source).toBe('from-link');
  });

  it('fetches the link once per page, not once per event', async () => {
    const { getTags, jsonResponse } = await load();
    window.history.replaceState(null, '', '/?s=abc');
    fetchMock.mockResolvedValue(jsonResponse(link({})));

    await getTags();
    await getTags();
    await getTags();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a link lookup that came back empty', async () => {
    const { getTags, jsonResponse } = await load();
    window.history.replaceState(null, '', '/?s=abc');
    fetchMock
      .mockResolvedValueOnce(jsonResponse('gone', 404))
      .mockResolvedValue(jsonResponse(link({ utm_source: 'recovered' })));

    expect((await getTags()).utm_source).toBeUndefined();
    expect((await getTags()).utm_source).toBe('recovered');
  });
});

describe('getDeviceId', () => {
  it('is stable across calls, via the configured storage', async () => {
    const { getDeviceId, memory } = await load();
    const id = getDeviceId();
    expect(getDeviceId()).toBe(id);
    expect(memory.map.get('device_id')).toBe(id);
  });
});

describe('storage', () => {
  it('round-trips through localStorage', async () => {
    const { storage } = await load();
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    expect(window.localStorage.getItem('k')).toBe('v');
  });

  it('falls back to memory when localStorage throws', async () => {
    const { storage } = await load();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');

    spy.mockRestore();
    getSpy.mockRestore();
  });
});
