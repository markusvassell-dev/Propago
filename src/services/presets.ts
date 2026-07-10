import { query } from '../db/pool';

// Pain-point presets + topic pools (DESIGN_SPEC §8.3). The two built-ins carry
// the prototype's 4+4 seeded topics; custom presets get a generated 3-topic pool.
// Preset state lives in app_settings ('presets', 'active_preset').

export interface PresetTopic {
  t: string;      // topic
  c: string;      // client
  k: string[];    // keywords
  pp: string;     // pain point
  src: string;    // source insight
}

export interface Preset {
  key: string;
  label: string;
  niche: string;
  audience: string;
  region: string;
  builtin?: boolean;
}

export const TOPICS_HS: PresetTopic[] = [
  {
    t: 'Grant funding for workplace wellbeing programmes',
    c: 'TrueNorth EHS',
    k: ['wellbeing grants', 'workplace health funding', 'EHS budget'],
    pp: 'Small EHS firms miss reclaimable wellbeing grants because eligibility rules change yearly and no one tracks them.',
    src: 'HSE funding bulletin + r/smallbusinessuk threads on missed grant windows'
  },
  {
    t: 'Insurance cost optimisation for construction safety firms',
    c: 'Sentinel Safety Group',
    k: ['liability insurance', 'construction safety costs', 'premium reduction'],
    pp: 'Construction safety firms overpay liability premiums by pricing on headcount, not verified incident records.',
    src: 'Trade forum: brokers quoting flat rates despite clean safety histories'
  },
  {
    t: 'Succession planning for family-run compliance firms',
    c: 'Bastion Risk Partners',
    k: ['succession planning', 'compliance firm valuation', 'exit strategy'],
    pp: 'Family compliance practices have no valuation baseline, so founders exit at a fraction of real worth.',
    src: 'Local business press: undervalued advisory-firm sales'
  },
  {
    t: 'VAT pitfalls in cross-border safety training',
    c: 'Halcyon Occupational Health',
    k: ['VAT training services', 'cross-border tax', 'safety training finance'],
    pp: 'Cross-border safety trainers mis-handle VAT place-of-supply rules and absorb avoidable tax.',
    src: 'HMRC guidance change + accountancy Q&A boards'
  }
];

export const TOPICS_YYC: PresetTopic[] = [
  {
    t: 'Cash-flow gaps for Calgary trades in the slow season',
    c: 'Bow River Contracting',
    k: ['seasonal cash flow', 'calgary trades', 'small business financing'],
    pp: 'Calgary trades hit a November–February cash gap and take on high-interest debt they never plan for.',
    src: 'Calgary Chamber survey + local trades Facebook groups'
  },
  {
    t: 'Alberta small business tax credits owners never claim',
    c: 'Prairie Table Café',
    k: ['alberta tax credits', 'small business deductions', 'yyc bookkeeping'],
    pp: 'YYC owners under 65 rarely claim Alberta innovation and hiring credits because their bookkeeper doesn’t flag them.',
    src: 'Alberta.ca tax bulletin + r/Calgary small biz threads'
  },
  {
    t: 'Pricing services against Calgary’s boom-bust demand',
    c: 'Stampede City Fitness',
    k: ['service pricing', 'calgary economy', 'recurring revenue'],
    pp: 'Calgary service businesses price for boom months, then bleed margin when energy-linked demand drops.',
    src: 'Local economist commentary + owner interviews'
  },
  {
    t: 'Succession & sale for Calgary’s aging small-business owners',
    c: 'Chinook Auto Care',
    k: ['business succession', 'selling a business calgary', 'valuation'],
    pp: 'A wave of 55–65 Calgary owners want to sell but have no clean books or valuation to show buyers.',
    src: 'CFIB succession report + Calgary business brokers'
  }
];

/** Custom presets get a generated 3-topic pool (mirrors the prototype's presetTopics). */
export function presetTopics(label: string, niche: string, audience: string, region: string): PresetTopic[] {
  const aud = audience || 'owner-managers';
  const kw = (extra: string) => [label, extra, region].filter(Boolean);
  const mk = (t: string): PresetTopic => ({
    t,
    c: `${label} — sample client`,
    k: kw('financial planning'),
    pp: niche,
    src: 'Preset research pool'
  });
  return [
    { ...mk(`Financial planning for ${label}`), k: kw('financial planning') },
    { ...mk(`Cash flow and pricing for ${aud}`), k: kw('cash flow') },
    { ...mk(`Tax reliefs ${aud} overlook`), k: kw('tax relief') }
  ];
}

export function topicsForPreset(p: Preset): PresetTopic[] {
  if (p.key === 'hs') return TOPICS_HS;
  if (p.key === 'yyc') return TOPICS_YYC;
  return presetTopics(p.label, p.niche, p.audience, p.region);
}

/** The master research prompt template (DESIGN_SPEC §8.3, verbatim). */
export function composePrompt(niche: string, audience: string): string {
  return (
    'ROLE: You are a market researcher for a financial advisory firm serving businesses with under-served pain points.\n\n' +
    `TARGET PAIN POINT: ${niche}\n` +
    `AUDIENCE: ${audience}\n\n` +
    'TASK: Scan recent local news, community forums and industry reports. Extract ONE concrete, underserved pain point this audience faces around money, tax, compliance or growth.\n\n' +
    'RETURN STRICT JSON: { "pain_point": "...", "source_insight": "..." }\n\n' +
    'RULES: The pain point must be specific enough to anchor a 1000+ word blog post and a lead magnet. No generic advice. Do NOT repeat any pain point already in the research registry — Levenshtein similarity > 0.7 counts as a duplicate; fetch another.'
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { rows } = await query<{ value: T }>('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows.length && rows[0].value !== null ? (rows[0].value as T) : fallback;
}

export async function activePreset(): Promise<Preset> {
  const presets = await getSetting<Preset[]>('presets', []);
  const key = await getSetting<string>('active_preset', 'hs');
  return presets.find((p) => p.key === key) ?? presets[0] ?? {
    key: 'hs',
    label: 'Health & Safety (UK)',
    niche: 'UK health & safety advisory & consultancy firms',
    audience: 'Owner-managers of H&S consultancies, aged 35–60',
    region: 'United Kingdom',
    builtin: true
  };
}
