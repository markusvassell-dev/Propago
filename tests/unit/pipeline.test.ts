import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { STAGES, SOCIAL_STAGES, stageIndex, mkStages } from '../../src/saga/stages';
import { STAGES as UI_STAGES } from '../../frontend/src/lib/types';
import { uiStatus } from '../../src/routes/mappers';
import { WordPressAdapter } from '../../src/adapters/WordPressAdapter';
import { generateSocialCaptions, generateAdsAndEmail } from '../../src/services/distributionCopy';
import { TERMINAL } from '../../src/services/karbonWork';
import { env } from '../../src/config/env';

// The 17-stage pipeline: blog draft → gate ① → live → social → gate ② → posts
// → ads/email → gate ③ → publish. These tests pin the invariants that are
// silent when broken — a drifted stage array or a post that publishes before
// its gate produces no error, just wrong behaviour.

describe('stage array', () => {
  it('backend and frontend STAGES stay in lockstep', () => {
    // stage_state is a POSITIONAL array. If these two lists ever diverge the
    // dashboard renders every run against the wrong stages, with no error
    // anywhere — the pipeline strip just quietly lies.
    expect(UI_STAGES.map((s) => s.key)).toEqual(STAGES.map((s) => s.key));
    expect(UI_STAGES.map((s) => s.strip)).toEqual(STAGES.map((s) => s.strip));
  });

  it('mkStages produces one entry per stage, all pending', () => {
    const st = mkStages();
    expect(st).toHaveLength(STAGES.length);
    expect(st.every((s) => s.status === 'pending')).toBe(true);
  });

  it('puts the WordPress draft BEFORE the first gate and go-live after it', () => {
    // The whole point of the two-step publish: a human sees the post in its
    // real theme, and nothing is public until they approve.
    expect(stageIndex('deploy')).toBeLessThan(stageIndex('review'));
    expect(stageIndex('golive')).toBeGreaterThan(stageIndex('review'));
  });

  it('orders the three gates: blog → social → ads/email', () => {
    expect(stageIndex('review')).toBeLessThan(stageIndex('socialreview'));
    expect(stageIndex('socialreview')).toBeLessThan(stageIndex('distreview'));
  });

  it('generates each batch only after the gate before it', () => {
    // Captions quote the live URL, so they cannot be written before go-live.
    expect(stageIndex('socialgen')).toBeGreaterThan(stageIndex('golive'));
    // Ads/email are written after the social batch is released at gate ②.
    expect(stageIndex('distgen')).toBeGreaterThan(stageIndex('socialreview'));
  });

  it('gives every social platform its own stage between gate ② and distgen', () => {
    expect(SOCIAL_STAGES).toEqual(['linkedin', 'facebook', 'instagram']);
    for (const k of SOCIAL_STAGES) {
      expect(stageIndex(k)).toBeGreaterThan(stageIndex('socialreview'));
      expect(stageIndex(k)).toBeLessThan(stageIndex('distgen'));
    }
  });

  it('matches the gate indices the Review UI reads stage timings from', () => {
    // frontend/src/pages/Review.tsx → GATE_STAGE_IDX. Hard-coded there because
    // the run payload carries stage_state as a bare array.
    expect(stageIndex('review')).toBe(5);
    expect(stageIndex('socialreview')).toBe(8);
    expect(stageIndex('distreview')).toBe(13);
  });
});

describe('uiStatus', () => {
  it('maps each gate to its own reviewable status', () => {
    expect(uiStatus('seo_review')).toBe('review');
    expect(uiStatus('social_review')).toBe('socialreview');
    expect(uiStatus('dist_review')).toBe('distreview');
  });

  it('keeps abort distinct from reject and failure', () => {
    // Abort happens after the post is live; reject means nothing was published
    // and failure means the system broke. Collapsing them would misreport.
    expect(uiStatus('aborted')).toBe('aborted');
    expect(uiStatus('rejected')).toBe('rejected');
    expect(uiStatus('failed')).toBe('failed');
  });

  it('treats every in-flight status as running', () => {
    for (const s of ['publishing_live', 'social_generating', 'social_publishing', 'dist_generating', 'publishing']) {
      expect(uiStatus(s)).toBe('running');
    }
  });
});

describe('Karbon batch settle', () => {
  it('treats every terminal run status as settled', () => {
    // A status missing here keeps the batch permanently "in flight": the work
    // item never leaves the trigger status, so Karbon re-fires nothing and the
    // run silently strands. `aborted` was exactly this bug.
    const terminalUiStates = ['complete', 'failed', 'rejected', 'aborted'];
    for (const s of terminalUiStates) expect(TERMINAL).toContain(s);
  });

  it('does not treat an abort as an in-flight run', () => {
    expect(TERMINAL.includes('aborted')).toBe(true);
  });
});

describe('WordPressAdapter two-step publish', () => {
  const original = env.wordpress.baseUrl;
  let post: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    env.wordpress.baseUrl = 'https://example.test';
    post = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { id: 4211, link: 'https://example.test/blog/a-post' } } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.wordpress.baseUrl = original;
  });

  it('creates the post as a draft, never as published', async () => {
    const res = await new WordPressAdapter().publishPost({
      title: 'A post',
      markdown: '## Heading\n\nBody copy.',
      metaDescription: 'Meta.',
      leadMagnetUrl: 'https://example.test/m.pdf',
      topicSlugSource: 'cash flow forecasting'
    });

    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.status).toBe('draft');
    expect(res.cmsPostId).toBe('4211');
    expect(res.previewUrl).toContain('p=4211');
  });

  it('publishLive flips that same post id to published', async () => {
    await new WordPressAdapter().publishLive('4211');
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://example.test/wp-json/wp/v2/posts/4211');
    expect(body).toEqual({ status: 'publish' });
  });
});

describe('split distribution generation', () => {
  // Stub mode (no real OpenAI key) — deterministic, no network.
  const input = {
    topic: 'cash flow forecasting',
    blogTitle: 'Cash Flow Forecasting',
    metaDescription: 'A teaser.',
    liveUrl: 'https://example.test/blog/cash-flow-forecasting',
    leadMagnetUrl: 'https://example.test/m.pdf',
    leadMagnetName: 'Financial Health Checklist',
    keywords: ['cash flow forecasting'],
    brandVoice: 'Plain, direct.'
  };

  it('socialgen returns the three captions and nothing else', async () => {
    const social = await generateSocialCaptions(input);
    expect(Object.keys(social).sort()).toEqual(['facebook', 'instagram', 'linkedin']);
    expect(social.linkedin.length).toBeGreaterThan(0);
  });

  it('instagram caption carries no link — IG strips them', async () => {
    const social = await generateSocialCaptions(input);
    expect(social.instagram).not.toContain('http');
  });

  it('distgen returns ads + email and enforces the Meta length caps', async () => {
    const { metaAds, acEmail } = await generateAdsAndEmail(input);
    expect(metaAds.headline.length).toBeLessThanOrEqual(40);
    expect(metaAds.primaryText.length).toBeLessThanOrEqual(125);
    expect(acEmail.subject.length).toBeGreaterThan(0);
    expect(acEmail.body).toContain('{{ first_name }}');
  });
});
