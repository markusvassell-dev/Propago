import axios, { AxiosError } from 'axios';
import { env } from '../config/env';
import { ContentGenerationProvider, GenerationRequest, GenerationResult } from './types';
import { LeadMagnetContent, storeLeadMagnet } from '../services/leadMagnetPdf';
import { stubGenerate } from '../services/stubContent';

// OpenAIGenerationAdapter (CLAUDE.md rule 6 — direct ChatGPT API; the Replit
// offload is retired). Runs inside the BullMQ generation worker. Errors are
// caught and re-thrown as clean GenerationError instances so BullMQ's retry
// policy (3×, exponential 2s→4s→8s) runs before the saga's terminal-failure
// path posts "Workflow Failed" to the Karbon timeline.

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

const MIN_WORDS = 1000; // contract: the saga rejects anything shorter

interface ModelOutput {
  blogTitle?: string;
  metaDescription?: string;
  blogMarkdown?: string;
  leadMagnet?: Partial<LeadMagnetContent>;
}

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

export class OpenAIGenerationAdapter implements ContentGenerationProvider {
  readonly name = 'openai-generation';

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const started = Date.now();

    // Structural stub mode (placeholder OPENAI_API_KEY): deterministic content
    // shaped like the prototype's drafts, so local/dev pipelines run end-to-end
    // without spending tokens. Real keys always take the live path below.
    let out: ModelOutput;
    if (env.openaiStub) {
      out = stubGenerate(req);
    } else {
      out = await this.completeJSON<ModelOutput>([
        { role: 'system', content: this.systemPrompt(req.brandVoice) },
        { role: 'user', content: this.userPrompt(req) }
      ]);
    }

    let markdown = out.blogMarkdown ?? '';

    // The model sometimes comes up short — expand once before failing the job.
    if (!env.openaiStub && markdown && wordCount(markdown) < MIN_WORDS) {
      const expanded = await this.completeJSON<{ blogMarkdown?: string }>([
        { role: 'system', content: this.systemPrompt(req.brandVoice) },
        {
          role: 'user',
          content:
            `Expand the following blog post to at least ${MIN_WORDS + 300} words. Keep the structure and voice; deepen each section with concrete, practical detail. ` +
            `Return STRICT JSON: { "blogMarkdown": string }\n\n${markdown}`
        }
      ]);
      if (expanded.blogMarkdown && wordCount(expanded.blogMarkdown) > wordCount(markdown)) {
        markdown = expanded.blogMarkdown;
      }
    }

    if (!markdown) {
      // Malformed 200 — treat as retryable.
      throw new GenerationError(
        'OpenAI returned 200 but the payload is missing blogMarkdown',
        200,
        JSON.stringify(out).slice(0, 800)
      );
    }
    const words = wordCount(markdown);
    if (words < MIN_WORDS) {
      throw new GenerationError(`Generated post is ${words} words — contract requires ${MIN_WORDS}+`, 200);
    }

    // Render + store the lead-magnet PDF. Served by THIS app at /magnets/:id.pdf
    // (stored in Postgres so links survive Railway redeploys).
    const magnet: LeadMagnetContent = {
      name: out.leadMagnet?.name || `${req.topic} Checklist`,
      subtitle: out.leadMagnet?.subtitle ?? '',
      sections: out.leadMagnet?.sections ?? [],
      cta: out.leadMagnet?.cta ?? ''
    };
    let stored: { url: string; name: string };
    try {
      stored = await storeLeadMagnet(req.runId ?? null, magnet);
    } catch (err) {
      throw new GenerationError(`Lead-magnet PDF render/store failed: ${(err as Error).message}`);
    }

    return {
      blogTitle: out.blogTitle || req.topic,
      metaDescription: out.metaDescription ?? '',
      blogMarkdown: markdown,
      leadMagnetUrl: stored.url,
      leadMagnetName: stored.name,
      leadMagnetText: [
        magnet.name,
        magnet.subtitle,
        ...magnet.sections.flatMap((s) => [s.heading, ...s.items]),
        magnet.cta
      ]
        .filter(Boolean)
        .join('\n'),
      wordCount: words,
      generatorLatencyMs: Date.now() - started
    };
  }

  // ---------------- prompts (ported unchanged from the retired generator) ----

  private systemPrompt(brandVoice: string): string {
    return [
      'You are the senior content writer for a UK financial advisory firm serving under-served niches (health & safety consultancies and similar SME sectors).',
      brandVoice ? `BRAND VOICE — follow it exactly in all copy:\n${brandVoice}` : '',
      'Business-focused, practical, zero fluff. UK English. No exclamation marks. No emoji.',
      '',
      'Return STRICT JSON with exactly these keys:',
      '{',
      '  "blogTitle": string,                       // compelling, ≤ 70 chars',
      '  "metaDescription": string,                 // ≤ 155 chars',
      `  "blogMarkdown": string,                    // the FULL post in Markdown, MINIMUM ${MIN_WORDS + 200} words, H2/H3 headings, keywords woven in naturally, ends with a short CTA to download the lead magnet`,
      '  "leadMagnet": {',
      '    "name": string,                          // e.g. "The H&S Consultancy Cash-Flow Checklist" — ends with a format word like Checklist/Guide/Toolkit',
      '    "subtitle": string,                      // one line',
      '    "sections": [ { "heading": string, "items": [string, ...] } ],  // 3-5 sections, 4-6 actionable items each, full sentences',
      '    "cta": string                            // 1-2 sentence closing call to action for the firm',
      '  }',
      '}'
    ]
      .filter(Boolean)
      .join('\n');
  }

  private userPrompt(req: GenerationRequest): string {
    const kw = req.keywords.join(', ');
    return [
      `Topic: ${req.topic}`,
      kw ? `Target keywords: ${kw}` : '',
      req.tone ? `Tone: ${req.tone}` : '',
      req.variant
        ? `This is content set ${req.variant.seq} of ${req.variant.of} generated from one trigger — take a distinct angle from the other sets (different hook, structure and lead-magnet focus).`
        : '',
      req.remake
        ? 'A reviewer discarded the previous draft entirely — start fresh with a different approach; do not reuse its structure.'
        : '',
      req.revisionNote
        ? `A human reviewer rejected the previous draft with this note — address it fully:\n${req.revisionNote}`
        : '',
      req.seoFixes?.length
        ? `The internal SEO scorer flagged the previous draft below threshold. Apply every one of these fixes in the regenerated post:\n- ${req.seoFixes.join('\n- ')}`
        : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ---------------- OpenAI call + error classification ----------------------

  private async completeJSON<T>(messages: Array<{ role: string; content: string }>): Promise<T> {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: env.openaiModel,
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 4096,
          messages
        },
        {
          headers: { Authorization: `Bearer ${env.openaiApiKey}` },
          timeout: env.generationTimeoutMs
        }
      );
      return JSON.parse(res.data.choices[0].message.content) as T;
    } catch (err) {
      throw this.classify(err);
    }
  }

  private classify(err: unknown): GenerationError {
    if (err instanceof GenerationError) return err;
    if (err instanceof SyntaxError) {
      return new GenerationError(`OpenAI returned non-JSON content: ${err.message}`, 200);
    }
    const e = err as AxiosError;
    if (e.code === 'ECONNABORTED') {
      return new GenerationError(`OpenAI request timed out after ${env.generationTimeoutMs}ms — will retry`);
    }
    if (e.response) {
      const body = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
      if (e.response.status === 401) {
        return new GenerationError('OpenAI rejected OPENAI_API_KEY (auth failure)', 401, body.slice(0, 800));
      }
      if (e.response.status === 429) {
        return new GenerationError('OpenAI rate limit / quota exhausted (429) — will retry', 429, body.slice(0, 800));
      }
      return new GenerationError(`OpenAI responded ${e.response.status}`, e.response.status, body.slice(0, 800));
    }
    return new GenerationError(`Network error reaching OpenAI: ${(e as Error).message ?? String(err)}`);
  }
}
