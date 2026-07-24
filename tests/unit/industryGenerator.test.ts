import { describe, it, expect } from 'vitest';
import { generateForIndustry, toPresetTopics } from '../../src/services/industryGenerator';
import { topicsForPreset, promptForPreset, composePrompt, Preset } from '../../src/services/presets';

// OPENAI_API_KEY is a placeholder in tests ⇒ env.openaiStub is true, so
// generateForIndustry returns deterministic sample output with no network call.

describe('generateForIndustry (stub mode)', () => {
  it('returns a master prompt and the requested number of pain points', async () => {
    const g = await generateForIndustry({
      industry: 'Dental practices',
      region: 'Calgary, AB',
      audience: 'Practice owners 35-60',
      count: 3
    });
    expect(g.stub).toBe(true);
    expect(g.industry).toBe('Dental practices');
    expect(g.painPoints).toHaveLength(3);
    expect(g.masterPrompt.length).toBeGreaterThan(50);
    for (const p of g.painPoints) {
      expect(p.painPoint).toBeTruthy();
      expect(p.topic).toBeTruthy();
      expect(Array.isArray(p.keywords)).toBe(true);
    }
  });

  it('clamps the count to 1..8', async () => {
    expect((await generateForIndustry({ industry: 'X', region: '', audience: '', count: 99 })).painPoints).toHaveLength(8);
    expect((await generateForIndustry({ industry: 'X', region: '', audience: '', count: 0 })).painPoints).toHaveLength(1);
    expect((await generateForIndustry({ industry: 'X', region: '', audience: '' })).painPoints).toHaveLength(5);
  });

  it('rejects an empty industry', async () => {
    await expect(generateForIndustry({ industry: '   ', region: '', audience: '' })).rejects.toThrow('industry_required');
  });

  it('reports gptOnly when there is no live search key', async () => {
    const g = await generateForIndustry({ industry: 'Veterinary clinics', region: 'AB', audience: 'Owners' });
    expect(typeof g.gptOnly).toBe('boolean'); // true in CI (no SERPAPI_KEY)
  });
});

describe('toPresetTopics', () => {
  it('maps generated pain points into the runner topic shape', () => {
    const topics = toPresetTopics({
      industry: 'Dental practices',
      painPoints: [
        { painPoint: 'Owners miss equipment CCA claims.', topic: 'Equipment write-offs', keywords: ['cca', 'dental'], sourceInsight: 'CRA bulletin' }
      ]
    });
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      t: 'Equipment write-offs',
      pp: 'Owners miss equipment CCA claims.',
      src: 'CRA bulletin'
    });
    expect(topics[0].k).toEqual(['cca', 'dental']);
  });
});

describe('preset wiring — generated content wins over derived defaults', () => {
  const base: Preset = { key: 'ind-x', label: 'Dental', niche: 'Dental practices', audience: 'Owners', region: 'AB' };

  it('promptForPreset uses the generated masterPrompt when present', () => {
    expect(promptForPreset(base)).toBe(composePrompt(base.niche, base.audience)); // falls back
    expect(promptForPreset({ ...base, masterPrompt: 'CUSTOM PROMPT' })).toBe('CUSTOM PROMPT');
    expect(promptForPreset({ ...base, masterPrompt: '   ' })).toBe(composePrompt(base.niche, base.audience));
  });

  it('topicsForPreset uses the generated pool when present', () => {
    const gen = [{ t: 'T', c: '', k: ['k'], pp: 'P', src: 'S' }];
    expect(topicsForPreset({ ...base, topics: gen })).toEqual(gen);
    expect(topicsForPreset(base).length).toBeGreaterThan(0); // derived fallback
  });

  it('built-in preset pools still resolve', () => {
    expect(topicsForPreset({ ...base, key: 'yyc' }).length).toBe(4);
    expect(topicsForPreset({ ...base, key: 'hs' }).length).toBe(4);
  });
});
