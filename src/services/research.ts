import axios from 'axios';
import { env } from '../config/env';
import { query } from '../db/pool';
import { checkAndRegisterPainPoint } from './registryService';
import { composePrompt, getSetting, activePreset } from './presets';

// Research stage (DESIGN_SPEC §2.1 rule 2, §13.1): web search + ChatGPT extract
// ONE pain point, guarded by Levenshtein > 0.7 vs prior research registry
// entries. Duplicate ⇒ registry row 'duplicate-blocked' ⇒ re-extract.

export interface ResearchResult {
  painPoint: string;
  sourceInsight: string;
  lev: number; // similarity vs nearest prior pain point
  attempts: number;
}

interface ExtractHint {
  painPoint?: string;
  sourceInsight?: string;
}

async function extractViaOpenAI(topic: string, keywords: string[], avoid: string[]): Promise<{ pain_point: string; source_insight: string }> {
  const masterPrompt =
    (await getSetting<string | null>('master_prompt', null)) ??
    composePrompt((await activePreset()).niche, (await activePreset()).audience);
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: env.openaiModel,
      response_format: { type: 'json_object' },
      temperature: 0.8,
      messages: [
        { role: 'system', content: masterPrompt },
        {
          role: 'user',
          content:
            `Blog topic context: ${topic}\nKeywords: ${keywords.join(', ')}` +
            (avoid.length ? `\nAlready-registered pain points to avoid (Levenshtein > 0.7 is a duplicate):\n- ${avoid.join('\n- ')}` : '')
        }
      ]
    },
    { headers: { Authorization: `Bearer ${env.openaiApiKey}` }, timeout: env.generationTimeoutMs }
  );
  return JSON.parse(res.data.choices[0].message.content);
}

function stubExtract(topic: string, hint: ExtractHint, attempt: number): { pain_point: string; source_insight: string } {
  if (hint.painPoint && attempt === 1) {
    return { pain_point: hint.painPoint, source_insight: hint.sourceInsight ?? 'Web search digest + forum threads' };
  }
  const suffix = attempt > 1 ? ` — angle ${attempt}: hidden cost exposure` : '';
  return {
    pain_point: `Firms facing "${topic}" have no financial playbook for it${suffix}`,
    source_insight: hint.sourceInsight ?? 'Web search digest + industry forum threads'
  };
}

/**
 * Runs the extraction with the Levenshtein research guard: up to 3 attempts,
 * re-extracting when the registry flags a duplicate. The winning pain point is
 * saved to the run row and the research registry ('unique').
 */
export async function runResearch(
  runId: string,
  topic: string,
  keywords: string[],
  hint: ExtractHint
): Promise<ResearchResult> {
  const { rows } = await query<{ title: string }>(
    `SELECT title FROM content_registry WHERE asset_type = 'painpoint' AND status <> 'duplicate-blocked' ORDER BY created_at DESC LIMIT 20`
  );
  const avoid = rows.map((r) => r.title);

  let last: { pain_point: string; source_insight: string } | null = null;
  let lev = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = env.openaiStub ? stubExtract(topic, hint, attempt) : await extractViaOpenAI(topic, keywords, avoid);
    const check = await checkAndRegisterPainPoint(runId, last.pain_point);
    lev = check.lev;
    if (!check.duplicate) {
      await query(
        `UPDATE workflow_runs SET pain_point = $1, source_insight = $2, levenshtein = $3, updated_at = now() WHERE id = $4`,
        [last.pain_point, last.source_insight, lev, runId]
      );
      return { painPoint: last.pain_point, sourceInsight: last.source_insight, lev, attempts: attempt };
    }
    avoid.push(last.pain_point);
  }
  // 3 duplicates in a row — accept the last extraction rather than park the
  // run (the registry keeps the blocked rows as the audit of what happened).
  await query(
    `UPDATE workflow_runs SET pain_point = $1, source_insight = $2, levenshtein = $3, updated_at = now() WHERE id = $4`,
    [last!.pain_point, last!.source_insight, lev, runId]
  );
  return { painPoint: last!.pain_point, sourceInsight: last!.source_insight, lev, attempts: 3 };
}
