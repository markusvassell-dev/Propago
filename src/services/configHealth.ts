import { env } from '../config/env';

// Config & credential health.
//
// Every one of these checks exists because it actually cost us a live outage:
//   · DATABASE_URL resolved to an empty string  → app booted, migration died
//   · KARBON_ACCESS_KEY carried a "•" (U+2022)  → every Karbon call threw before
//     leaving the process (headers must be ASCII), with no obvious cause
//   · WORDPRESS_USERNAME was literally "filler" → auth failed on every publish
//   · A ${{Service.VAR}} reference that never resolved was stored verbatim
//
// Plus credential EXPIRY: a LinkedIn token lasts ~60 days and simply stops
// working — posts stop appearing and nothing announces it. We track issue dates
// so the dashboard can warn before the silence starts.

export type Severity = 'error' | 'warn' | 'ok';

export interface ConfigIssue {
  key: string;
  severity: Severity;
  problem: string;
  fix: string;
}

const PLACEHOLDER = /^(filler|changeme|change-me|set-?me|placeholder|todo|tbd|xxx+|your[-_ ]?\w+|\[.*\])$/i;

/** Vars whose absence/corruption breaks something, with a human fix hint. */
const WATCHED: Array<{ key: string; value: () => string; required: boolean; fix: string }> = [
  { key: 'DATABASE_URL', value: () => process.env.DATABASE_URL ?? '', required: true, fix: 'Set the full postgresql:// connection string (a ${{...}} reference that resolves empty will break boot).' },
  { key: 'REDIS_URL', value: () => process.env.REDIS_URL ?? '', required: true, fix: 'Set the full redis:// connection string.' },
  { key: 'OPENAI_API_KEY', value: () => env.openaiApiKey, required: true, fix: 'Create a key on the OpenAI project that holds your credits.' },
  { key: 'KARBON_BEARER_TOKEN', value: () => env.karbon.bearerToken, required: false, fix: 'Karbon → Settings → API access.' },
  { key: 'KARBON_ACCESS_KEY', value: () => env.karbon.accessKey, required: false, fix: 'Re-copy the full JWT from Karbon — masked characters corrupt it.' },
  { key: 'KARBON_WEBHOOK_SIGNING_KEY', value: () => env.karbon.webhookSigningKey, required: false, fix: 'The SigningKey used when creating the Work webhook subscription.' },
  { key: 'WORDPRESS_BASE_URL', value: () => env.wordpress.baseUrl, required: false, fix: 'Site root only (no /blog, no trailing slash) — the app appends /wp-json/wp/v2.' },
  { key: 'WORDPRESS_USERNAME', value: () => env.wordpress.username, required: false, fix: 'Your WordPress login username (not the display name).' },
  { key: 'WORDPRESS_APP_PASSWORD', value: () => env.wordpress.appPassword, required: false, fix: 'WP Admin → Users → Profile → Application Passwords.' },
  { key: 'AC_API_KEY', value: () => env.activeCampaign.apiKey, required: false, fix: 'ActiveCampaign → Settings → Developer.' },
  { key: 'FB_PAGE_ACCESS_TOKEN', value: () => env.social.fbPageToken, required: false, fix: 'Page token derived from a long-lived user token (does not expire).' },
  { key: 'LINKEDIN_ACCESS_TOKEN', value: () => env.social.linkedinToken, required: false, fix: 'LinkedIn OAuth 2.0 tools → scopes w_member_social, openid, profile.' }
];

/** First non-ASCII character in a string, or -1. Headers must be latin1-safe. */
export function firstNonAscii(v: string): number {
  for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) > 255) return i;
  return -1;
}

export function inspectValue(key: string, raw: string, required: boolean, fix: string): ConfigIssue | null {
  const v = (raw ?? '').trim();

  if (!v) {
    return required
      ? { key, severity: 'error', problem: 'Empty — the app cannot run without it.', fix }
      : null; // optional + empty is simply "not configured", reported elsewhere
  }
  if (/\$\{\{.*\}\}/.test(v)) {
    return { key, severity: 'error', problem: 'Contains an unresolved ${{…}} reference — it was stored literally instead of resolving.', fix: 'Replace with the real value, or re-pick the reference from the service dropdown.' };
  }
  const bad = firstNonAscii(v);
  if (bad >= 0) {
    return {
      key,
      severity: 'error',
      problem: `Contains a non-ASCII character at position ${bad} (often a “•” pasted from a masked field) — requests using it fail before they are sent.`,
      fix: `Re-copy the full value from the source. ${fix}`
    };
  }
  if (PLACEHOLDER.test(v)) {
    return { key, severity: 'error', problem: `Still a placeholder value (“${v.slice(0, 24)}”).`, fix };
  }
  if (/\s$/.test(raw) || /^\s/.test(raw)) {
    return { key, severity: 'warn', problem: 'Has leading/trailing whitespace, which some providers reject.', fix: 'Trim the value.' };
  }
  return null;
}

/** Scan every watched variable. */
export function scanConfig(): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const w of WATCHED) {
    const issue = inspectValue(w.key, w.value(), w.required, w.fix);
    if (issue) issues.push(issue);
  }
  return issues;
}

// ---------------- credential expiry ----------------

export interface CredentialExpiry {
  id: string;
  label: string;
  /** null when the credential does not expire (or we have no issue date). */
  daysLeft: number | null;
  severity: Severity;
  note: string;
}

/** Lifetimes we know about. Issue dates come from env so they're operator-set. */
const LIFETIMES: Array<{ id: string; label: string; issuedEnv: string; days: number; note: string; configured: () => boolean }> = [
  {
    id: 'li',
    label: 'LinkedIn access token',
    issuedEnv: 'LINKEDIN_TOKEN_ISSUED',
    days: 60,
    note: 'Regenerate via LinkedIn → Docs and tools → OAuth 2.0 tools (scopes: w_member_social, openid, profile), then update LINKEDIN_ACCESS_TOKEN.',
    configured: () => !!env.social.linkedinToken
  }
];

export function expiryStatus(now = new Date()): CredentialExpiry[] {
  const out: CredentialExpiry[] = [];
  for (const l of LIFETIMES) {
    if (!l.configured()) continue;
    const issuedRaw = (process.env[l.issuedEnv] ?? '').trim();
    if (!issuedRaw) {
      out.push({
        id: l.id,
        label: l.label,
        daysLeft: null,
        severity: 'warn',
        note: `Expires about ${l.days} days after it was issued, but no issue date is recorded. Set ${l.issuedEnv}=YYYY-MM-DD to get advance warning. ${l.note}`
      });
      continue;
    }
    const issued = new Date(issuedRaw);
    if (Number.isNaN(issued.getTime())) {
      out.push({ id: l.id, label: l.label, daysLeft: null, severity: 'warn', note: `${l.issuedEnv} is not a valid date (use YYYY-MM-DD).` });
      continue;
    }
    const daysLeft = Math.floor((issued.getTime() + l.days * 864e5 - now.getTime()) / 864e5);
    const severity: Severity = daysLeft <= 0 ? 'error' : daysLeft <= 14 ? 'warn' : 'ok';
    out.push({
      id: l.id,
      label: l.label,
      daysLeft,
      severity,
      note:
        daysLeft <= 0
          ? `EXPIRED — posting to this channel is failing silently. ${l.note}`
          : daysLeft <= 14
            ? `Expires in ${daysLeft} day(s). ${l.note}`
            : `Valid for about ${daysLeft} more day(s).`
    });
  }
  return out;
}

export interface ConfigHealth {
  issues: ConfigIssue[];
  expiry: CredentialExpiry[];
  errors: number;
  warnings: number;
}

export function configHealth(now = new Date()): ConfigHealth {
  const issues = scanConfig();
  const expiry = expiryStatus(now);
  const all: Severity[] = [...issues.map((i) => i.severity), ...expiry.map((e) => e.severity)];
  return {
    issues,
    expiry,
    errors: all.filter((s) => s === 'error').length,
    warnings: all.filter((s) => s === 'warn').length
  };
}

/** Log a summary at boot so a broken deploy announces itself in the logs. */
export function logConfigHealthAtBoot(): void {
  const h = configHealth();
  if (h.errors === 0 && h.warnings === 0) {
    console.info('[config] all watched variables look sane');
    return;
  }
  for (const i of h.issues) {
    const line = `[config] ${i.severity.toUpperCase()} ${i.key}: ${i.problem} → ${i.fix}`;
    if (i.severity === 'error') console.error(line);
    else console.warn(line);
  }
  for (const e of h.expiry) {
    if (e.severity === 'ok') continue;
    console.warn(`[config] ${e.severity.toUpperCase()} ${e.label}: ${e.note}`);
  }
  console.warn(`[config] ${h.errors} error(s), ${h.warnings} warning(s) — see the Connections page for detail`);
}
