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
  generatorLatencyMs: number;
}

export interface ContentGenerationProvider {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

// ---------- CMS (WordPress default) ----------
export interface CmsPublishResult {
  liveUrl: string;
  cmsPostId: string;
  leadMagnetUrl: string;
}

export interface CmsPublisher {
  readonly name: string;
  publishPost(input: {
    title: string;
    markdown: string;
    metaDescription: string;
    leadMagnetUrl: string;
    existingPostId?: string; // update-in-place on revision redeploys
    topicSlugSource?: string; // spec §2 slug rule — slug comes from the topic
  }): Promise<CmsPublishResult>;
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
