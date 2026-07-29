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

// TARGET is what we ask for and what the SEO scorer rewards. FLOOR is the only
// value that fails the job. See env.blogWords for why they are different.
const TARGET_WORDS = env.blogWords.target;
const FLOOR_WORDS = env.blogWords.floor;

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
      // TWO calls, not one. The article and the lead magnet used to share a
      // single JSON response and therefore a single token budget — the magnet
      // ate room the article needed, and the article's own length pushed the
      // response into truncation. Splitting them lets each have the full
      // ceiling, and a short article no longer costs us the magnet too.
      const article = await this.completeJSON<ModelOutput>([
        { role: 'system', content: this.systemPrompt(req.brandVoice) },
        { role: 'user', content: this.userPrompt(req) }
      ]);
      const magnet = await this.completeJSON<{ leadMagnet?: Partial<LeadMagnetContent> }>([
        { role: 'system', content: this.magnetSystemPrompt(req.brandVoice) },
        { role: 'user', content: this.magnetUserPrompt(req, article.blogTitle ?? req.topic) }
      ]);
      out = { ...article, leadMagnet: magnet.leadMagnet };
    }

    let markdown = out.blogMarkdown ?? '';

    if (!markdown) {
      // Malformed 200 — treat as retryable.
      throw new GenerationError(
        'OpenAI returned 200 but the payload is missing blogMarkdown',
        200,
        JSON.stringify(out).slice(0, 800)
      );
    }

    // Short draft: ask for more. Each pass sends the current draft back and
    // asks the model to deepen it, keeping whichever version is longest — the
    // model occasionally returns a SHORTER "expansion", and silently accepting
    // that would make extra passes actively harmful.
    for (let pass = 0; !env.openaiStub && wordCount(markdown) < TARGET_WORDS && pass < env.blogWords.maxExpansions; pass++) {
      const before = wordCount(markdown);
      let expanded: { blogMarkdown?: string };
      try {
        expanded = await this.completeJSON<{ blogMarkdown?: string }>([
          { role: 'system', content: this.expandSystemPrompt(req.brandVoice) },
          {
            role: 'user',
            content:
              `This draft is ${before} words. Expand it to at least ${TARGET_WORDS + 300} words.\n` +
              'Keep the existing structure, headings and voice. Add depth, not padding: worked examples with real figures, ' +
              'the specific steps a reader would take, common mistakes and what they cost, and any thresholds or deadlines that apply. ' +
              'Do not repeat points already made and do not add a second conclusion.\n\n' +
              `Return STRICT JSON: { "blogMarkdown": string }\n\n${markdown}`
          }
        ]);
      } catch (err) {
        // An expansion pass is an optimisation. If it fails we still have a
        // usable draft, so keep it rather than losing the whole generation.
        console.warn(`[generation] expansion pass ${pass + 1} failed (non-fatal):`, (err as Error).message);
        break;
      }
      if (expanded.blogMarkdown && wordCount(expanded.blogMarkdown) > before) {
        markdown = expanded.blogMarkdown;
      } else {
        break; // no progress — another identical pass will not help
      }
    }

    const words = wordCount(markdown);
    // Only genuinely broken output fails the job. Anything between the floor
    // and the target is publishable and goes to review gate ① carrying a
    // `shortOfTarget` flag, which the SEO panel surfaces — a human decides
    // whether to approve it, request a revision, or remake it.
    if (words < FLOOR_WORDS) {
      throw new GenerationError(
        `Generated post is only ${words} words — below the ${FLOOR_WORDS}-word floor, treating as broken output`,
        200
      );
    }
    if (words < TARGET_WORDS) {
      console.warn(`[generation] post is ${words} words, under the ${TARGET_WORDS} target — flagged for review, not failed`);
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
      shortOfTarget: words < TARGET_WORDS ? { words, target: TARGET_WORDS } : undefined,
      generatorLatencyMs: Date.now() - started
    };
  }

  // ---------------- prompts (ported unchanged from the retired generator) ----

  private systemPrompt(brandVoice: string): string {
    return [
      `You are the senior content writer for ${env.content.firmDescription}.`,
      brandVoice ? `BRAND VOICE — follow it exactly in all copy:\n${brandVoice}` : '',
      `Business-focused, practical, zero fluff. ${env.content.englishVariant}. No exclamation marks. No emoji.`,
      '',
      // The internal scorer weights keyword density 30%, readability 30%,
      // heading structure 20%, meta tags 20%. State those rules explicitly —
      // the model was previously graded on a rubric it was never shown.
      'SEO REQUIREMENTS — the post is scored against these automatically, so satisfy every one:',
      '  · Use the PRIMARY keyword (the first target keyword) in the blogTitle, in the metaDescription, within the FIRST 100 WORDS of the post, and in at least one H2 heading.',
      '  · Keep primary-keyword density between 1.0% and 1.5% of total words — enough to register, never stuffed. Use natural variations elsewhere.',
      '  · Use the SECOND keyword in at least one H2 heading.',
      '  · Structure the post with AT LEAST 3 H2 headings (##) plus some H3 (###) subheadings.',
      '  · blogTitle must be ≤ 60 characters (it truncates in search results beyond that).',
      '  · metaDescription must be between 120 and 155 characters — use the full width.',
      '',
      'READABILITY — the scorer measures reading ease, and dense professional prose scores badly:',
      '  · Average sentence length under 20 words; never exceed 28 words in a sentence.',
      '  · Prefer short, common words over long formal ones (use "use" not "utilise", "help" not "facilitate").',
      '  · Define any technical or tax term in plain language the first time it appears.',
      '  · Write for a busy owner-operator, around a grade 8–9 reading level, without dumbing down the substance.',
      '',
      // Length is the requirement the model misses most often, so it gets its
      // own block with a reason attached rather than a clause buried in a
      // field comment. "Write more" alone produces padding; naming WHAT to add
      // is what actually produces length worth reading.
      `LENGTH — this is a hard requirement, not a guideline. The post must be AT LEAST ${TARGET_WORDS + 200} words.`,
      '  · Cover 4–6 substantial sections. A section is not done in two sentences.',
      '  · Add depth through specifics: worked examples with real figures, the exact steps to take,',
      '    thresholds and deadlines that apply, common mistakes and what each one costs.',
      '  · Never pad with restated points, filler transitions or a second conclusion.',
      '  · Count as you write. A post under the minimum is rejected and regenerated at cost.',
      '',
      'Return STRICT JSON with exactly these keys:',
      '{',
      '  "blogTitle": string,                       // compelling, ≤ 60 chars, contains the primary keyword',
      '  "metaDescription": string,                 // 120–155 chars, contains the primary keyword',
      `  "blogMarkdown": string                     // the FULL post in Markdown, MINIMUM ${TARGET_WORDS + 200} words, 3+ H2 headings, keywords woven in naturally, ends with a short CTA to download the companion checklist`,
      '}'
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** System prompt for the SEPARATE lead-magnet call (see generate()). */
  private magnetSystemPrompt(brandVoice: string): string {
    return [
      `You are the senior content writer for ${env.content.firmDescription}.`,
      brandVoice ? `BRAND VOICE — follow it exactly in all copy:\n${brandVoice}` : '',
      `Business-focused, practical, zero fluff. ${env.content.englishVariant}. No exclamation marks. No emoji.`,
      '',
      'You write the downloadable checklist that accompanies a blog post. Every item must be',
      'something the reader can actually do or check — an action, a figure to verify, a deadline',
      'to diarise. No motivational statements, no restating the blog post.',
      '',
      'Return STRICT JSON with exactly these keys:',
      '{',
      '  "leadMagnet": {',
      '    "name": string,                          // e.g. "The Calgary Trades Cash-Flow Checklist" — ends with a format word like Checklist/Guide/Toolkit',
      '    "subtitle": string,                      // one line',
      '    "sections": [ { "heading": string, "items": [string, ...] } ],  // 3-5 sections, 4-6 actionable items each, full sentences',
      '    "cta": string                            // 1-2 sentence closing call to action for the firm',
      '  }',
      '}'
    ]
      .filter(Boolean)
      .join('\n');
  }

  private magnetUserPrompt(req: GenerationRequest, blogTitle: string): string {
    const [primary] = req.keywords.filter(Boolean);
    return [
      `Blog post this checklist accompanies: "${blogTitle}"`,
      `Topic: ${req.topic}`,
      primary ? `Primary keyword: "${primary}"` : '',
      req.tone ? `Tone: ${req.tone}` : '',
      req.variant
        ? `This is content set ${req.variant.seq} of ${req.variant.of} — give the checklist a distinct focus from the other sets.`
        : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Lean system prompt for expansion passes — the full SEO rubric would fight
   *  the single instruction that matters here, which is "make it longer". */
  private expandSystemPrompt(brandVoice: string): string {
    return [
      `You are the senior content writer for ${env.content.firmDescription}.`,
      brandVoice ? `BRAND VOICE — follow it exactly:\n${brandVoice}` : '',
      `Business-focused, practical, zero fluff. ${env.content.englishVariant}. No exclamation marks. No emoji.`,
      'You expand existing drafts. Preserve every heading and keyword already present.',
      'Return STRICT JSON: { "blogMarkdown": string }'
    ]
      .filter(Boolean)
      .join('\n');
  }

  private userPrompt(req: GenerationRequest): string {
    const [primary, ...rest] = req.keywords.filter(Boolean);
    return [
      `Topic: ${req.topic}`,
      // Name the primary explicitly — the scorer checks THIS phrase in the
      // title, meta description, first 100 words and headings.
      primary ? `PRIMARY keyword (must appear in title, meta description, first 100 words, and an H2): "${primary}"` : '',
      rest.length ? `Secondary keywords (use "${rest[0]}" in at least one H2): ${rest.join(', ')}` : '',
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
          max_tokens: env.openaiMaxTokens,
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
