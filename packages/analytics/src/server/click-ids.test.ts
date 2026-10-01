import { describe, expect, it } from 'vitest';
import {
  googleClickIds,
  linkedinFatId,
  microsoftMsclkid,
  redditClickId,
  redditUuid,
} from './click-ids';

describe('click ids for the conversion senders', () => {
  it('takes the URL click id first and the cookie on a page without one', () => {
    const cookies = {
      _gcl_aw: 'GCL.1700000000.G_COOKIE',
      _gcl_gb: 'GCL.1700000000.W_COOKIE',
      _uetmsclkid: '_uetdd4afcccb1c94a4cad9544dd7e5006ab',
      _rdt_cid: 'R_COOKIE',
      _li_fat_id: 'LI_COOKIE',
    };
    const url = { gclid: 'G_URL', wbraid: 'W_URL', msclkid: 'M_URL', rdt_cid: 'R_URL' };

    expect(googleClickIds({ ...cookies, ...url, gbraid: 'B' })).toEqual({
      gclid: 'G_URL',
      gbraid: 'B',
      wbraid: 'W_URL',
    });
    expect(microsoftMsclkid({ ...cookies, ...url })).toBe('M_URL');
    expect(redditClickId({ ...cookies, ...url })).toBe('R_URL');
    expect(linkedinFatId({ ...cookies, li_fat_id: 'LI_URL' })).toBe('LI_URL');

    expect(googleClickIds(cookies)).toEqual({
      gclid: 'G_COOKIE',
      gbraid: undefined,
      wbraid: 'W_COOKIE',
    });
    expect(microsoftMsclkid(cookies)).toBe('dd4afcccb1c94a4cad9544dd7e5006ab');
    expect(redditClickId(cookies)).toBe('R_COOKIE');
    expect(linkedinFatId(cookies)).toBe('LI_COOKIE');
  });

  it('ignores a cookie in a shape its tag would not read back', () => {
    expect(googleClickIds({ _gcl_aw: 'garbage' }).gclid).toBeUndefined();
    expect(microsoftMsclkid({ _uetmsclkid: 'garbage' })).toBeUndefined();
  });

  it('still reads the Reddit browser id from clients older than 9.0.0', () => {
    expect(redditUuid({ _rdt_uuid: 'new', rdt_uuid: 'old' })).toBe('new');
    expect(redditUuid({ rdt_uuid: 'old' })).toBe('old');
  });
});
