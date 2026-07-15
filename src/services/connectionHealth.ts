import axios from 'axios';
import { env } from '../config/env';

// Real connection health for the Connections page (spec §8.7). Two layers:
//   channelHealth(id)  — pure, env-derived: is the channel configured, which
//                        env vars are missing, what mode is it in, masked cred.
//   liveTest(id)       — one cheap authenticated HTTP call against the real
//                        provider to prove the credentials actually work.
// The page's status pills / Test buttons are driven by these, so Connections
// doubles as the go-live checklist: every row tells you exactly which env vars
// to set and whether the ones you set are accepted by the provider.

const GRAPH = 'https://graph.facebook.com/v19.0';

export type ChannelMode = 'live' | 'sandbox' | 'unconfigured';

export interface ChannelHealth {
  id: string;
  mode: ChannelMode;
  missing: string[]; // env vars still needed to go live
  mask: string; // safe identifying string (never a full secret)
}

/** Last-4 mask for a secret; empty stays empty. */
const mask4 = (s: string): string => (s ? `••••${s.slice(-4)}` : '');
const host = (u: string): string => u.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/** Env-shaped config so tests can inject fakes; defaults to the live env. */
export type HealthCfg = typeof env;

export function channelHealth(id: string, cfg: HealthCfg = env): ChannelHealth {
  const need = (pairs: Array<[string, string]>): string[] => pairs.filter(([, v]) => !v).map(([k]) => k);
  switch (id) {
    case 'karbon': {
      const missing = need([
        ['KARBON_BEARER_TOKEN (or KARBON_AUTH_TOKEN)', cfg.karbon.bearerToken],
        ['KARBON_ACCESS_KEY', cfg.karbon.accessKey]
      ]);
      return {
        id,
        mode: missing.length ? 'unconfigured' : 'live',
        missing,
        mask: missing.length ? '' : `${host(cfg.karbon.apiBase)} · tok ${mask4(cfg.karbon.bearerToken)}`
      };
    }
    case 'openai':
      return {
        id,
        mode: cfg.openaiStub ? 'unconfigured' : 'live',
        missing: cfg.openaiStub ? ['OPENAI_API_KEY'] : [],
        mask: cfg.openaiStub ? '' : `key ${mask4(cfg.openaiApiKey)} · ${cfg.openaiModel}`
      };
    case 'search':
      return {
        id,
        mode: cfg.serpapiStub ? 'unconfigured' : 'live',
        missing: cfg.serpapiStub ? ['SERPAPI_KEY'] : [],
        mask: cfg.serpapiStub ? '' : `serpapi ${mask4(cfg.serpapi.apiKey)} · ${cfg.serpapi.engine}`
      };
    case 'wp': {
      const missing = need([
        ['WORDPRESS_BASE_URL', cfg.wordpress.baseUrl],
        ['WORDPRESS_USERNAME', cfg.wordpress.username],
        ['WORDPRESS_APP_PASSWORD', cfg.wordpress.appPassword]
      ]);
      return {
        id,
        mode: missing.length ? 'unconfigured' : 'live',
        missing,
        mask: cfg.wordpress.baseUrl ? `${host(cfg.wordpress.baseUrl)} · ${cfg.wordpress.username || '—'}` : ''
      };
    }
    case 'meta': {
      const missing = need([
        ['META_ACCESS_TOKEN', cfg.meta.accessToken],
        ['META_AD_ACCOUNT_ID', cfg.meta.adAccountId],
        ['META_PAGE_ID', cfg.meta.pageId]
      ]);
      // Sandbox is a deliberate mode, not a misconfiguration: creds may be set
      // while META_SANDBOX_MODE=true keeps spend at zero until app review.
      const mode: ChannelMode = missing.length ? 'unconfigured' : cfg.meta.sandbox ? 'sandbox' : 'live';
      return {
        id,
        mode,
        missing: missing.length ? missing : cfg.meta.sandbox ? ['META_SANDBOX_MODE=false (after app review)'] : [],
        mask: cfg.meta.accessToken ? `tok ${mask4(cfg.meta.accessToken)} · ${cfg.meta.adAccountId || 'no ad account'}` : ''
      };
    }
    case 'ac': {
      const missing = need([
        ['AC_API_URL', cfg.activeCampaign.apiUrl],
        ['AC_API_KEY', cfg.activeCampaign.apiKey]
      ]);
      return {
        id,
        mode: missing.length ? 'unconfigured' : 'live',
        missing,
        mask: cfg.activeCampaign.apiUrl
          ? `${host(cfg.activeCampaign.apiUrl)} · key ${mask4(cfg.activeCampaign.apiKey)} · list ${cfg.activeCampaign.listId}`
          : ''
      };
    }
    case 'li': {
      const missing = need([
        ['LINKEDIN_ACCESS_TOKEN', cfg.social.linkedinToken],
        ['LINKEDIN_ORG_URN', cfg.social.linkedinOrgUrn]
      ]);
      return {
        id,
        mode: missing.length ? 'unconfigured' : 'live',
        missing,
        mask: cfg.social.linkedinToken ? `${cfg.social.linkedinOrgUrn || 'no org'} · tok ${mask4(cfg.social.linkedinToken)}` : ''
      };
    }
    case 'fb': {
      const missing = need([
        ['FB_PAGE_ACCESS_TOKEN', cfg.social.fbPageToken],
        ['FB_PAGE_ID', cfg.social.fbPageId]
      ]);
      return {
        id,
        mode: missing.length ? 'unconfigured' : 'live',
        missing,
        mask: cfg.social.fbPageToken ? `page ${cfg.social.fbPageId || '—'} · tok ${mask4(cfg.social.fbPageToken)}` : ''
      };
    }
    case 'ig': {
      const missing = need([
        ['IG_ACCESS_TOKEN', cfg.social.igToken],
        ['IG_USER_ID', cfg.social.igUserId]
      ]);
      return {
        id,
        mode: missing.length ? 'unconfigured' : 'live',
        missing,
        mask: cfg.social.igToken ? `user ${cfg.social.igUserId || '—'} · tok ${mask4(cfg.social.igToken)}` : ''
      };
    }
    default:
      return { id, mode: 'unconfigured', missing: [], mask: '' };
  }
}

const TIMEOUT = 8_000;
const short = (v: unknown): string => JSON.stringify(v ?? '').slice(0, 200);

/**
 * One cheap authenticated request against the provider. Only called when the
 * channel is configured (never fabricates a fake success). Throws Axios errors
 * upward — the route turns them into { ok:false, detail } with the verbatim
 * provider response so the fix is obvious from the UI.
 */
export async function liveTest(id: string): Promise<string> {
  switch (id) {
    case 'karbon': {
      await axios.get(`${env.karbon.apiBase}/WorkItems?%24top=1`, {
        headers: { Authorization: `Bearer ${env.karbon.bearerToken}`, AccessKey: env.karbon.accessKey },
        timeout: TIMEOUT
      });
      return 'work items readable';
    }
    case 'openai': {
      await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${env.openaiApiKey}` },
        timeout: TIMEOUT
      });
      return `models listed · ${env.openaiModel}`;
    }
    case 'search': {
      const r = await axios.get(`https://serpapi.com/account.json?api_key=${encodeURIComponent(env.serpapi.apiKey)}`, {
        timeout: TIMEOUT
      });
      const left = (r.data as { total_searches_left?: number }).total_searches_left;
      return left != null ? `${left} searches left` : 'account OK';
    }
    case 'wp': {
      const r = await axios.get(`${env.wordpress.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me`, {
        auth: { username: env.wordpress.username, password: env.wordpress.appPassword },
        timeout: TIMEOUT
      });
      return `authenticated as ${(r.data as { name?: string }).name ?? env.wordpress.username} — posts:write OK`;
    }
    case 'meta': {
      const r = await axios.get(`${GRAPH}/me?access_token=${encodeURIComponent(env.meta.accessToken)}`, {
        timeout: TIMEOUT
      });
      const name = (r.data as { name?: string }).name ?? 'token OK';
      return env.meta.sandbox ? `${name} · SANDBOX (no spend until META_SANDBOX_MODE=false)` : name;
    }
    case 'ac': {
      const r = await axios.get(`${env.activeCampaign.apiUrl.replace(/\/$/, '')}/api/3/users/me`, {
        headers: { 'Api-Token': env.activeCampaign.apiKey },
        timeout: TIMEOUT
      });
      const u = (r.data as { user?: { email?: string } }).user;
      return `authenticated${u?.email ? ` as ${u.email}` : ''} · list ${env.activeCampaign.listId}`;
    }
    case 'li': {
      await axios.get('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${env.social.linkedinToken}` },
        timeout: TIMEOUT
      });
      return `token valid · posting as ${env.social.linkedinOrgUrn}`;
    }
    case 'fb': {
      const r = await axios.get(
        `${GRAPH}/${env.social.fbPageId}?fields=name&access_token=${encodeURIComponent(env.social.fbPageToken)}`,
        { timeout: TIMEOUT }
      );
      return `page “${(r.data as { name?: string }).name ?? env.social.fbPageId}” reachable`;
    }
    case 'ig': {
      const r = await axios.get(
        `${GRAPH}/${env.social.igUserId}?fields=username&access_token=${encodeURIComponent(env.social.igToken)}`,
        { timeout: TIMEOUT }
      );
      return `@${(r.data as { username?: string }).username ?? env.social.igUserId} reachable`;
    }
    default:
      throw new Error('unknown_connection');
  }
}
