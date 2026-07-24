import axios from 'axios';
import { env } from '../config/env';
import { SerpApiAdapter, digestHits } from '../adapters/SerpApiAdapter';
import { composePrompt, PresetTopic } from './presets';

// Target-industry generator (Orchestrator → "Target Industry").
//
// Given {industry, region, audience} an admin types in, this:
//   1. runs live web/news searches (SerpAPI) so output reflects what's actually
//      being written/discussed now, not GPT's training recall,
//   2. asks OpenAI for a tailored MASTER RESEARCH PROMPT for that industry, plus
//      N concrete, underserved pain points with a topic + keywords + source,
//   3. returns them for ADMIN REVIEW — nothing is saved here. The caller decides
//      what to keep and saves it as a preset (see routes: generate → save).
//
// Stub-safe: with a placeholder OPENAI_API_KEY it returns deterministic sample
// output so the flow is exercisable without spend; SerpAPI degrades to [].

const webSearch = new SerpApiAdapter();

export interface IndustryInput {
  industry: string;
  region: string;
  audience: string;
  /** How many pain points to generate (clamped 1..8, default 5). */
  count?: number;
}

export interface GeneratedPainPoint {
  painPoint: string;
  topic: string;
  keywords: string[];
  sourceInsight: string;
}

export interface IndustryGeneration {
  industry: string;
  region: string;
  audience: string;
  /** Tailored master research prompt for this industry. */
  masterPrompt: string;
  painPoints: GeneratedPainPoint[];
  /** True when generated without live search (no SERPAPI_KEY). */
  gptOnly: boolean;
  /** True when OpenAI was stubbed (no real key) — sample output. */
  stub: boolean;
}

const clampCount = (n: number | undefined): number => Math.min(8, Math.max(1, Math.floor(n ?? 5)));

/** Two searches: one industry/market angle, one money/tax/compliance angle. */
async function gatherSearchDigest(input: IndustryInput): Promise<string> {
  const { industry, region, audience } = input;
  const queries = [
    `${industry} ${region} small business challenges cash flow tax compliance`,
    `${industry} ${region} ${audience} financial problems news`
  ];
  const results = await Promise.all(queries.map((q) => webSearch.search({ query: q }).catch(() => [])));
  const hits = results.flat();
  return hits.length ? digestHits(hits) : '';
}

function stubGeneration(input: IndustryInput, gptOnly: boolean): IndustryGeneration {
  const { industry, region, audience } = input;
  const n = clampCount(input.count);
  const samples: GeneratedPainPoint[] = [
    {
      painPoint: `${industry} operators in ${region} price jobs on gut feel and lose margin they never see on paper.`,
      topic: `What ${industry} owners get wrong about pricing`,
      keywords: [industry, 'pricing strategy', region],
      sourceInsight: 'Sample output — set a real OPENAI_API_KEY for live generation'
    },
    {
      painPoint: `${audience} in ${industry} miss deductible expenses because receipts never reach the bookkeeper.`,
      topic: `Deductions ${industry} businesses routinely miss`,
      keywords: [industry, 'tax deductions', 'bookkeeping'],
      sourceInsight: 'Sample output — set a real OPENAI_API_KEY for live generation'
    },
    {
      painPoint: `Seasonal swings leave ${industry} firms in ${region} short on cash in the off months.`,
      topic: `Managing seasonal cash flow in ${industry}`,
      keywords: [industry, 'cash flow', 'seasonality'],
      sourceInsight: 'Sample output — set a real OPENAI_API_KEY for live generation'
    }
  ];
  return {
    industry,
    region,
    audience,
    masterPrompt: composePrompt(`${industry} businesses in ${region}`, audience),
    painPoints: Array.from({ length: n }, (_, i) => samples[i % samples.length]),
    gptOnly,
    stub: true
  };
}

/**
 * Generate a master research prompt + candidate pain points for an industry.
 * Never persists anything — the caller reviews and saves.
 */
export async function generateForIndustry(input: IndustryInput): Promise<IndustryGeneration> {
  const industry = input.industry.trim();
  const region = input.region.trim();
  const audience = input.audience.trim();
  const count = clampCount(input.count);
  if (!industry) throw new Error('industry_required');

  const digest = await gatherSearchDigest({ industry, region, audience });
  const gptOnly = digest.length === 0;

  if (env.openaiStub) {
    console.info(`[industry-gen] stub mode — sample output for "${industry}"`);
    return stubGeneration({ industry, region, audience, count }, gptOnly);
  }

  const system =
    'You are a market-research strategist for an accounting and advisory firm. ' +
    'You design research prompts and surface underserved, specific business pain points that a firm can write authoritative content about. ' +
    'You never invent statistics, and you never give specific tax advice.';

  const user =
    `TARGET INDUSTRY: ${industry}\n` +
    `REGION: ${region || 'not specified'}\n` +
    `AUDIENCE: ${audience || 'owner-managers'}\n\n` +
    (digest
      ? `Live web/news results — ground everything below in what these actually say:\n${digest}\n\n`
      : 'No live search results available; rely on well-established industry knowledge and avoid anything time-sensitive.\n\n') +
    `TASK — return STRICT JSON with exactly this shape:\n` +
    `{\n` +
    `  "master_prompt": "a reusable research prompt (150-250 words) instructing a researcher to find ONE specific underserved money/tax/compliance/growth pain point for this industry, audience and region. It must demand strict JSON output of {\\"pain_point\\",\\"source_insight\\"}, forbid generic advice, and require the pain point be specific enough to anchor a 1000+ word article and a lead magnet.",\n` +
    `  "pain_points": [\n` +
    `    { "pain_point": "one specific, concrete problem (1-2 sentences)", "topic": "a compelling blog title addressing it", "keywords": ["3 search keywords"], "source_insight": "what evidence/source suggests this (name the publisher if from the results above)" }\n` +
    `  ]\n` +
    `}\n\n` +
    `RULES: exactly ${count} pain points, each materially DIFFERENT from the others (not variations of one theme). ` +
    `Each must be about money, tax, compliance, or growth — the things an accounting firm can credibly speak to. ` +
    `Be specific to ${industry}${region ? ` in ${region}` : ''}; avoid advice that would apply to any business. No fabricated statistics.`;

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: env.openaiModel,
      response_format: { type: 'json_object' },
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    { headers: { Authorization: `Bearer ${env.openaiApiKey}` }, timeout: env.generationTimeoutMs }
  );

  const parsed = JSON.parse(res.data.choices[0].message.content) as {
    master_prompt?: string;
    pain_points?: Array<{ pain_point?: string; topic?: string; keywords?: unknown; source_insight?: string }>;
  };

  const painPoints: GeneratedPainPoint[] = (parsed.pain_points ?? [])
    .filter((p) => (p.pain_point ?? '').trim())
    .slice(0, count)
    .map((p) => ({
      painPoint: (p.pain_point ?? '').trim(),
      topic: (p.topic ?? '').trim() || `Financial planning for ${industry}`,
      keywords: Array.isArray(p.keywords) ? p.keywords.map(String).slice(0, 5) : [industry],
      sourceInsight: (p.source_insight ?? '').trim() || (digest ? 'Live web/news digest' : 'Industry knowledge')
    }));

  console.info(
    `[industry-gen] "${industry}" (${region || 'no region'}) — ${painPoints.length} pain point(s), ${gptOnly ? 'GPT-only' : 'web-grounded'}`
  );

  return {
    industry,
    region,
    audience,
    masterPrompt: (parsed.master_prompt ?? '').trim() || composePrompt(`${industry} businesses in ${region}`, audience),
    painPoints,
    gptOnly,
    stub: false
  };
}

/** Map reviewed pain points into the preset topic-pool shape the runner uses. */
export function toPresetTopics(gen: { industry: string; painPoints: GeneratedPainPoint[] }): PresetTopic[] {
  return gen.painPoints.map((p) => ({
    t: p.topic,
    c: '',
    k: p.keywords,
    pp: p.painPoint,
    src: p.sourceInsight
  }));
}
