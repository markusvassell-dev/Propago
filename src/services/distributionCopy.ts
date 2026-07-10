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

export async function generateDistributionPayloads(input: {
  topic: string;
  blogTitle: string;
  metaDescription: string;
  liveUrl: string;
  leadMagnetUrl: string;
  leadMagnetName: string;
  keywords: string[];
  brandVoice: string;
}): Promise<DistributionPayloads> {
  if (env.openaiStub) return deterministicFallback(input);

  const system = [
    'You write distribution copy for a financial advisory firm.',
    `BRAND VOICE (must be followed exactly): ${input.brandVoice}`,
    'Return STRICT JSON with keys: metaAds {headline, primaryText, link}, acEmail {subject, body}, social {linkedin, facebook, instagram}.',
    'Constraints: headline ≤ 40 chars; primaryText ≤ 125 chars; email body is plain text, greets with {{ first_name }}, includes the lead magnet link then the blog link; linkedin/facebook captions include the blog URL; instagram caption has NO links and ends with "link in bio" plus 2–3 niche hashtags.',
    'Business-focused, zero fluff. Never use exclamation marks.'
  ].join('\n');

  const user = JSON.stringify({
    topic: input.topic,
    blogTitle: input.blogTitle,
    teaser: input.metaDescription,
    blogUrl: input.liveUrl,
    leadMagnet: { name: input.leadMagnetName, url: input.leadMagnetUrl },
    keywords: input.keywords
  });

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

  const parsed = JSON.parse(res.data.choices[0].message.content) as DistributionPayloads;
  // Hard-enforce Meta limits even if the model drifts.
  parsed.metaAds.headline = parsed.metaAds.headline.slice(0, 40);
  parsed.metaAds.primaryText = parsed.metaAds.primaryText.slice(0, 125);
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
