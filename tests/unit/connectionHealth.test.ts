import { describe, it, expect } from 'vitest';
import { channelHealth, HealthCfg } from '../../src/services/connectionHealth';
import { env } from '../../src/config/env';

// channelHealth is pure over an injected cfg — build variants from the real
// env shape so the test tracks the config structure.

const base = (): HealthCfg =>
  JSON.parse(
    JSON.stringify({
      ...env,
      karbon: { ...env.karbon, bearerToken: '', accessKey: '' },
      openaiStub: true,
      serpapiStub: true,
      wordpress: { baseUrl: '', username: '', appPassword: '' },
      meta: { accessToken: '', adAccountId: '', pageId: '', sandbox: true },
      activeCampaign: { apiUrl: '', apiKey: '', listId: '1', signupFormUrl: '' },
      social: { linkedinToken: '', linkedinOrgUrn: '', fbPageToken: '', fbPageId: '', igToken: '', igUserId: '' }
    })
  ) as HealthCfg;

describe('channelHealth — env-derived go-live status', () => {
  it('unconfigured channels name the exact missing env vars', () => {
    const cfg = base();
    expect(channelHealth('wp', cfg)).toMatchObject({
      mode: 'unconfigured',
      missing: ['WORDPRESS_BASE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD']
    });
    expect(channelHealth('li', cfg).missing).toEqual(['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORG_URN']);
    expect(channelHealth('ac', cfg).missing).toEqual(['AC_API_URL', 'AC_API_KEY']);
    expect(channelHealth('karbon', cfg).missing).toContain('KARBON_ACCESS_KEY');
  });

  it('fully configured channels report live with a masked cred', () => {
    const cfg = base();
    cfg.wordpress = { baseUrl: 'https://example.ca', username: 'jude', appPassword: 'abcd efgh' };
    const h = channelHealth('wp', cfg);
    expect(h.mode).toBe('live');
    expect(h.missing).toEqual([]);
    expect(h.mask).toContain('example.ca');
    expect(h.mask).not.toContain('abcd'); // never leaks the secret
  });

  it('meta distinguishes sandbox (deliberate) from unconfigured', () => {
    const cfg = base();
    cfg.meta = { accessToken: 'EAAG-token-value', adAccountId: 'act_1', pageId: 'p1', sandbox: true };
    const sandbox = channelHealth('meta', cfg);
    expect(sandbox.mode).toBe('sandbox');
    expect(sandbox.missing.join(' ')).toContain('META_SANDBOX_MODE=false');

    cfg.meta.sandbox = false;
    expect(channelHealth('meta', cfg).mode).toBe('live');

    cfg.meta.accessToken = '';
    expect(channelHealth('meta', cfg).mode).toBe('unconfigured');
  });

  it('masks show only the last 4 characters of secrets', () => {
    const cfg = base();
    cfg.social.igToken = 'IGQVJsecrettoken9x7z';
    cfg.social.igUserId = '178414';
    const h = channelHealth('ig', cfg);
    expect(h.mode).toBe('live');
    expect(h.mask).toContain('••••9x7z');
    expect(h.mask).not.toContain('secrettoken');
  });

  it('unknown ids degrade safely', () => {
    expect(channelHealth('nope', base()).mode).toBe('unconfigured');
  });
});
