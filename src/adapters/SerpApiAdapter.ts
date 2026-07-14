import axios from 'axios';
import { env } from '../config/env';
import { WebSearchProvider, WebSearchHit } from './types';

// SerpAPI adapter (default WebSearchProvider). Grounds the research stage in
// real, current web/news results instead of GPT's training-cutoff recall.
//
// Structural-stub safe: with no real SERPAPI_KEY (env.serpapiStub) `search`
// returns [] and never makes a network call, so the research stage falls back
// to today's GPT-only behaviour. A real key switches live search on with no
// other code change.
//
// Engine is configurable (SERPAPI_ENGINE): 'google' for evergreen web results,
// 'google_news' for timely/news results. Retries/backoff are the caller's job —
// a failed search degrades to [] (research still runs) rather than throwing.

export class SerpApiAdapter implements WebSearchProvider {
  readonly name = 'serpapi';
  readonly stub = env.serpapiStub;

  async search({ query, count }: { query: string; count?: number }): Promise<WebSearchHit[]> {
    if (this.stub) {
      console.info('[serpapi:stub] no key — research runs GPT-only for query:', query.slice(0, 80));
      return [];
    }

    const num = count ?? env.serpapi.resultCount;
    try {
      const res = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: env.serpapi.engine,
          q: query,
          num,
          api_key: env.serpapi.apiKey
        },
        timeout: env.serpapi.timeoutMs,
        validateStatus: (s) => s >= 200 && s < 300
      });
      return normalizeResults(res.data, num);
    } catch (err) {
      // Search is an enhancement, not a hard dependency: log and degrade to
      // GPT-only rather than failing the run. The api_key is never logged.
      const msg = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}`.trim() : String(err);
      console.warn(`[serpapi] search failed (${msg}) — falling back to GPT-only research`);
      return [];
    }
  }
}

/**
 * Map SerpAPI's response into WebSearchHit[]. Handles both the `organic_results`
 * (google) and `news_results` (google_news) shapes, taking whichever is present.
 */
function normalizeResults(data: unknown, limit: number): WebSearchHit[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const raw =
    (Array.isArray(d.news_results) && (d.news_results as unknown[])) ||
    (Array.isArray(d.organic_results) && (d.organic_results as unknown[])) ||
    [];

  const hits: WebSearchHit[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const link = typeof item.link === 'string' ? item.link : '';
    if (!title || !link) continue;
    hits.push({
      title,
      link,
      snippet: typeof item.snippet === 'string' ? item.snippet.trim() : '',
      source:
        typeof item.source === 'string'
          ? item.source
          : typeof item.displayed_link === 'string'
            ? item.displayed_link
            : undefined,
      date: typeof item.date === 'string' ? item.date : undefined
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Render hits into a compact digest for an LLM prompt (empty string if none). */
export function digestHits(hits: WebSearchHit[]): string {
  return hits
    .map((h, i) => {
      const meta = [h.source, h.date].filter(Boolean).join(', ');
      const head = meta ? `${h.title} (${meta})` : h.title;
      return `${i + 1}. ${head}\n   ${h.snippet}\n   ${h.link}`;
    })
    .join('\n');
}
