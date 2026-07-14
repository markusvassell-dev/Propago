import { describe, it, expect } from 'vitest';
import { SerpApiAdapter, digestHits } from '../../src/adapters/SerpApiAdapter';
import type { WebSearchHit } from '../../src/adapters/types';

// tests/setup.ts leaves SERPAPI_KEY unset, so the adapter is in stub mode:
// search() must return [] and make NO network call (the test would hang/throw
// otherwise). This is the exact fallback that keeps research GPT-only until a
// real key is added.
describe('SerpApiAdapter — stub-safe fallback', () => {
  it('reports stub mode and returns no hits without a key', async () => {
    const a = new SerpApiAdapter();
    expect(a.stub).toBe(true);
    await expect(a.search({ query: 'cash flow forecasting occupational health' })).resolves.toEqual([]);
  });
});

describe('digestHits — LLM prompt formatting', () => {
  it('renders each hit as numbered title (source, date) + snippet + link', () => {
    const hits: WebSearchHit[] = [
      { title: 'CRA updates T2 rules', link: 'https://ex.com/a', snippet: 'New filing guidance.', source: 'CBC', date: '2 days ago' },
      { title: 'Cash flow tips', link: 'https://ex.com/b', snippet: 'Forecast weekly.' }
    ];
    const d = digestHits(hits);
    expect(d).toContain('1. CRA updates T2 rules (CBC, 2 days ago)');
    expect(d).toContain('https://ex.com/a');
    expect(d).toContain('2. Cash flow tips'); // no meta parens when source/date absent
    expect(d).not.toContain('()');
  });

  it('returns empty string for no hits (⇒ GPT-only extract)', () => {
    expect(digestHits([])).toBe('');
  });
});
