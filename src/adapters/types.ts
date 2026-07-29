// Adapter contracts — the modular-monolith seams. Every external service sits
// behind one of these interfaces so providers can be swapped without touching
// the saga (e.g. WordPress → Ghost, OpenAI → another model provider).

export interface KarbonTrigger {
  workItemId: string;
  stageId: string;
  clientName: string;
  topic: string;
  keywords: string[];
  tone: string;
}

// ---------- Content generation (direct OpenAI — CLAUDE.md rule 6) ----------
export interface GenerationRequest {
  topic: string;
  keywords: string[];
  tone: string;
  brandVoice: string;        // rule 7 — injected into every generation request
  revisionNote?: string;     // present when a reviewer looped the draft back
  remake?: boolean;          // reviewer discarded the draft — start fresh, don't tweak
  seoFixes?: string[];       // auto-SEO loop: scorer suggestions fed back to the model
  variant?: { seq: number; of: number }; // fan-out position (1..3): distinct angle per content set
  runId?: string;            // links stored artifacts (lead-magnet PDF) to the run
}

export interface GenerationResult {
  blogTitle: string;
  metaDescription: string;
  blogMarkdown: string;      // full 1000+ word post
  leadMagnetUrl: string;     // public PDF URL served by THIS app (/magnets/:id.pdf)
  leadMagnetName: string;
  leadMagnetText: string;    // flattened magnet content — Uniqueness Registry fingerprint input
  wordCount: number;
  /** Set when the post is publishable but under the target length. The run
   *  still reaches review gate ①; the SEO panel shows this as a warning so a
   *  human decides, instead of the job failing outright. */
  shortOfTarget?: { words: number; target: number };
  generatorLatencyMs: number;
}

export interface ContentGenerationProvider {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

// ---------- Web search / news (SerpAPI default) — research stage grounding ----------
export interface WebSearchHit {
  title: string;
  link: string;
  snippet: string;
  source?: string; // publisher / domain
  date?: string;   // published date when the engine reports one (news)
}

export interface WebSearchProvider {
  readonly name: string;
  readonly stub: boolean; // true ⇒ returns no live results; caller runs GPT-only
  search(input: { query: string; count?: number }): Promise<WebSearchHit[]>;
}

// ---------- CMS (WordPress default) ----------
export interface CmsPublishResult {
  liveUrl: string;
  cmsPostId: string;
  leadMagnetUrl: string;
  /** Logged-in preview link for a draft (WP `?p=<id>&preview=true`). */
  previewUrl?: string;
}

export interface CmsPublisher {
  readonly name: string;
  /** Creates the post as a DRAFT — see WordPressAdapter for the two-step flow. */
  publishPost(input: {
    title: string;
    markdown: string;
    metaDescription: string;
    leadMagnetUrl: string;
    existingPostId?: string; // update-in-place on revision redeploys
    topicSlugSource?: string; // spec §2 slug rule — slug comes from the topic
    // Assigned as real WordPress terms so the THEME renders its own tag row and
    // share buttons under the post, exactly as on hand-written posts. Faking
    // that markup in the post body would style wrong and produce dead links.
    tags?: string[];
    category?: string;
    leadMagnetName?: string;
  }): Promise<CmsPublishResult>;
  /** Flips an existing draft to status=publish. Called on gate ① approval. */
  publishLive(postId: string): Promise<{ liveUrl: string }>;
}

// ---------- Paid ads (Meta Marketing API, sandbox until app review) ----------
export interface AdCreateResult {
  campaignId: string;
  adSetId: string;
  adId: string;
  sandbox: boolean;
}

export interface AdPlatform {
  readonly name: string;
  createLeadGenCampaign(input: {
    headline: string;
    primaryText: string;
    destinationUrl: string; // ActiveCampaign sign-up form; UTM enforced by adapter
    campaignSlug: string;
  }): Promise<AdCreateResult>;
}

// ---------- Email (ActiveCampaign) ----------
export interface EmailSendResult {
  campaignId: string;
  recipientCount: number;
}

export interface EmailProvider {
  readonly name: string;
  createAndSendCampaign(input: {
    subject: string;
    body: string; // plain text with {{ first_name }} merge tags; adapter converts + UTMs links
    campaignSlug: string;
  }): Promise<EmailSendResult>;
}

// ---------- Organic social (independent, non-blocking — one per platform) ----------
export interface SocialPostResult {
  platform: 'linkedin' | 'facebook' | 'instagram';
  ok: boolean;
  postId?: string;
  error?: string; // verbatim HTTP error body for the audit trail / dashboard modal
}

export interface SocialPublisher {
  readonly platform: SocialPostResult['platform'];
  publish(input: { caption: string; linkUrl: string | null; campaignSlug: string }): Promise<SocialPostResult>;
}
