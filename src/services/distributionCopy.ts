import axios from 'axios';
import { env } from '../config/env';
import { stubCaptions } from './stubContent';

// Distribution copy generation (CLAUDE.md rules 5 + 7).
// Blog + lead-magnet generation also calls OpenAI directly
// (OpenAIGenerationAdapter — the Replit offload is retired).
// The global brand voice is prepended to the system prompt (rule 7).

export interface MetaAdsPayload {
  headline: string;    // ≤ 40 chars
  primaryText: string; // ≤ 125 chars
  link: string;        // ActiveCampaign sign-up form URL (UTM appended at publish)
}
export interface AcEmailPayload {
  subject: string;
  body: string; // plain text; {{ first_name }} merge tag allowed
}
export interface SocialPayload {
  linkedin: string;
  facebook: string;
  instagram: string; // no links — "link in bio"
}
export interface DistributionPayloads {
  metaAds: MetaAdsPayload;
  acEmail: AcEmailPayload;
  social: SocialPayload;
}

export interface DistributionInput {
  topic: string;
  blogTitle: string;
  metaDescription: string;
  liveUrl: string;
  leadMagnetUrl: string;
  leadMagnetName: string;
  keywords: string[];
  brandVoice: string;
}

/** Shared prompt scaffolding for both generation stages. */
function messages(input: DistributionInput, task: string, shape: string, constraints: string) {
  return {
    system: [
      `You write ${task} for a financial advisory firm.`,
      `BRAND VOICE (must be followed exactly): ${input.brandVoice}`,
      `Return STRICT JSON with keys: ${shape}.`,
      `Constraints: ${constraints}`,
      'Business-focused, zero fluff. Never use exclamation marks.'
    ].join('\n'),
    user: JSON.stringify({
      topic: input.topic,
      blogTitle: input.blogTitle,
      teaser: input.metaDescription,
      blogUrl: input.liveUrl,
      leadMagnet: { name: input.leadMagnetName, url: input.leadMagnetUrl },
      keywords: input.keywords
    })
  };
}

async function chat<T>(system: string, user: string): Promise<T> {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    {
      headers: { Authorization: `Bearer ${env.openaiApiKey}` },
      timeout: 45_000
    }
  );
  return JSON.parse(res.data.choices[0].message.content) as T;
}

/**
 * Stage `socialgen` — the three platform captions only. Runs straight after
 * the post goes live, so the captions can quote the real published URL.
 */
export async function generateSocialCaptions(input: DistributionInput): Promise<SocialPayload> {
  if (env.openaiStub) return deterministicFallback(input).social;
  const { system, user } = messages(
    input,
    'organic social captions',
    'linkedin, facebook, instagram (all strings)',
    'linkedin and facebook captions include the blog URL; instagram caption has NO links and ends with "link in bio" plus 2–3 niche hashtags.'
  );
  const parsed = await chat<SocialPayload>(system, user);
  return {
    linkedin: parsed.linkedin ?? '',
    facebook: parsed.facebook ?? '',
    instagram: parsed.instagram ?? ''
  };
}

/**
 * Stage `distgen` — paid ad creative + the campaign email. Runs after the
 * social batch has been approved and posted (gate ②).
 */
export async function generateAdsAndEmail(
  input: DistributionInput
): Promise<{ metaAds: MetaAdsPayload; acEmail: AcEmailPayload }> {
  if (env.openaiStub) {
    const { metaAds, acEmail } = deterministicFallback(input);
    return { metaAds, acEmail };
  }
  const { system, user } = messages(
    input,
    'paid ad creative and campaign email copy',
    'metaAds {headline, primaryText, link}, acEmail {subject, body}',
    'headline ≤ 40 chars; primaryText ≤ 125 chars; email body is plain text, greets with {{ first_name }}, includes the lead magnet link then the blog link.'
  );
  const parsed = await chat<{ metaAds: MetaAdsPayload; acEmail: AcEmailPayload }>(system, user);
  // Hard-enforce Meta limits even if the model drifts.
  parsed.metaAds.headline = (parsed.metaAds.headline ?? '').slice(0, 40);
  parsed.metaAds.primaryText = (parsed.metaAds.primaryText ?? '').slice(0, 125);
  parsed.metaAds.link ||= env.activeCampaign.signupFormUrl;
  return parsed;
}

/** Keeps the pipeline runnable in dev/CI without an OpenAI key — copy mirrors the design prototype's mkDist. */
function deterministicFallback(input: {
  topic: string;
  blogTitle: string;
  metaDescription: string;
  liveUrl: string;
  leadMagnetUrl: string;
  leadMagnetName: string;
  keywords: string[];
}): DistributionPayloads {
  const T = input.blogTitle.replace(/: The 2026 Guide$/, '') || input.topic.charAt(0).toUpperCase() + input.topic.slice(1);
  const magName = input.leadMagnetName.split(' — ')[0] || 'Financial Health Checklist';
  const teaser = input.metaDescription;
  const slug3 = input.topic
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join('-');
  const captions = stubCaptions({
    title: input.blogTitle,
    teaser,
    blogUrl: input.liveUrl,
    keywords: input.keywords
  });
  return {
    metaAds: {
      headline: `Free: ${magName}`.slice(0, 40),
      primaryText:
        'Project income is volatile. Get the 12-point checklist our advisory team uses to stabilise cash flow — free download.'.slice(0, 125),
      link: env.activeCampaign.signupFormUrl || `elementaccounting.activehosted.com/f/${slug3}`
    },
    acEmail: {
      subject: `Your ${magName} (free download inside)`,
      body: [
        'Hi {{ first_name }},',
        '',
        `New on the blog: ${T}.`,
        '',
        teaser,
        '',
        `Download the ${magName}:`,
        input.leadMagnetUrl,
        '',
        'Read the full post:',
        input.liveUrl,
        '',
        '— The Element Accounting team'
      ].join('\n')
    },
    social: captions
  };
}
