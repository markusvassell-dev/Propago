import { describe, it, expect } from 'vitest';
import { deriveKeywords } from '../../src/utils/keywords';
import { scoreSeo } from '../../src/services/seoScorer';
import { buildTrigger } from '../../src/services/karbonWork';

describe('deriveKeywords', () => {
  it('builds a multi-word primary phrase from the title', () => {
    const kw = deriveKeywords('Cash Flow Forecasting for Occupational Health Providers');
    expect(kw[0]).toBe('cash flow forecasting');
    expect(kw.length).toBeGreaterThan(1);
  });

  it('drops stopwords and filler', () => {
    const kw = deriveKeywords('How to get the most from your 2026 tax planning guide');
    expect(kw[0]).not.toMatch(/\b(how|the|your|guide|2026)\b/);
    expect(kw[0].split(' ').length).toBeGreaterThanOrEqual(2);
  });

  it('appends context (work type / industry) without duplicating', () => {
    const kw = deriveKeywords('Payroll remittance deadlines', ['Bookkeeping'], 3);
    expect(kw).toContain('bookkeeping');
    expect(new Set(kw).size).toBe(kw.length);
  });

  it('returns [] only for empty/meaningless input, and respects max', () => {
    expect(deriveKeywords('')).toEqual([]);
    expect(deriveKeywords('the and of')).toEqual([]);
    expect(deriveKeywords('Cash flow forecasting for clinics', [], 2).length).toBeLessThanOrEqual(2);
  });
});

describe('Karbon trigger supplies keywords (regression: empty array capped SEO at ~50)', () => {
  it('buildTrigger derives keywords from the work-item title', () => {
    const t = buildTrigger(
      { Title: 'Cash Flow Forecasting for Clinics', WorkType: 'Advisory' },
      {},
      'WI-1',
      'Ready for Propago'
    );
    expect(t.keywords.length).toBeGreaterThan(0);
    expect(t.keywords[0]).toContain('cash flow');
  });
});

describe('scoreSeo — keyword presence is worth ~30 points', () => {
  // A well-formed post: primary keyword in title, meta, intro and an H2.
  const primary = 'cash flow forecasting';
  // ~500 words of filler that does NOT contain the phrase, so we can place the
  // primary keyword deliberately and land inside the 1.0–1.5% target band.
  const filler = (n: number, s: string) => Array.from({ length: n }, () => s).join(' ');
  const body =
    `Cash flow forecasting is how clinic owners see the next 90 days before they arrive. ` +
    `Most owners guess instead, and the guess is usually wrong.\n\n` +
    `## Why cash flow forecasting matters\n\n` +
    filler(30, 'Plan the month with clear numbers and short weekly reviews.') +
    `\n\n## Building your forecast\n\n` +
    filler(30, 'List the money coming in and the money going out for each week.') +
    ` Good cash flow forecasting starts with last year figures.\n\n` +
    `### A weekly habit\n\n` +
    filler(30, 'Check the plan against the bank balance every Friday morning.') +
    `\n\n## Common clinic mistakes\n\n` +
    filler(28, 'The plan fails when nobody owns it or updates it.') +
    ` Treat cash flow forecasting as a habit, not a one-off task.`;

  const args = {
    blogText: body,
    title: 'Cash flow forecasting for clinic owners',
    metaDescription:
      'Cash flow forecasting for clinic owners: a simple weekly routine to see the next 90 days of cash before it happens.',
    keywords: [primary, 'clinic mistakes']
  };

  it('scores materially higher WITH keywords than with none', () => {
    const withKw = scoreSeo(args);
    const withoutKw = scoreSeo({ ...args, keywords: [] });
    // No keywords ⇒ density defaults to 50/100 and can never be earned.
    expect(withoutKw.breakdown.keywordDensity).toBe(50);
    expect(withKw.breakdown.keywordDensity).toBeGreaterThan(50);
    expect(withKw.total).toBeGreaterThan(withoutKw.total);
  });

  it('rewards the structure the generator is now instructed to produce', () => {
    const r = scoreSeo(args);
    expect(r.breakdown.headingStructure).toBeGreaterThanOrEqual(90); // 3+ H2 with H3
    expect(r.breakdown.metaTags).toBeGreaterThanOrEqual(75); // in-range meta + keyword present
  });
});
