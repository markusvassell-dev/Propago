// Keyword derivation for SEO scoring + generation.
//
// The scorer weights keyword density at 30% and needs a PRIMARY keyword to
// score at all — with an empty keywords array it silently defaults to 50/100,
// which is unearnable. Karbon-triggered runs carry no keywords (the webhook
// only gives us a work-item title), so we derive sensible ones from the topic.
//
// This is deliberately simple and deterministic: a 2–3 word noun phrase from
// the title is a far better primary keyword than nothing, and the research
// step can still overwrite these with web-grounded keywords when it runs.

const STOPWORDS = new Set([
  'a','an','the','and','or','but','for','nor','so','yet','of','to','in','on','at','by','from','with','about','into',
  'over','after','before','between','under','above','your','you','our','we','us','it','its','is','are','was','were',
  'be','been','being','do','does','did','how','what','why','when','where','which','who','whom','this','that','these',
  'those','can','could','should','would','will','shall','may','might','must','have','has','had','not','no','than',
  'then','there','here','more','most','some','any','all','each','every','other','new','get','getting','guide','2024',
  '2025','2026','ways','tips','things'
]);

const clean = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Derive up to `max` keyword phrases from a topic/title (+ optional context
 * words such as an industry or region). Returns [] only for empty input.
 *
 * The first entry is the PRIMARY keyword — a 2–3 word phrase built from the
 * most meaningful consecutive words in the title, which is what the scorer
 * checks for in the intro, title, meta description and headings.
 */
export function deriveKeywords(topic: string, context: string[] = [], max = 3): string[] {
  const words = clean(topic).split(' ').filter(Boolean);
  const meaningful = words.filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (meaningful.length === 0) return [];

  const out: string[] = [];

  // Primary: the first 2–3 consecutive meaningful words — reads like a real
  // search phrase ("cash flow forecasting") rather than a single vague noun.
  const primaryLen = Math.min(3, Math.max(2, meaningful.length));
  const primary = meaningful.slice(0, primaryLen).join(' ');
  out.push(primary);

  // Secondary: the next distinct phrase, so headings have something to carry.
  if (meaningful.length > primaryLen) {
    const secondary = meaningful.slice(primaryLen, primaryLen + 2).join(' ');
    if (secondary && secondary !== primary) out.push(secondary);
  }

  // Context (industry / region) pairs well with the primary head noun.
  for (const c of context) {
    if (out.length >= max) break;
    const cc = clean(c);
    if (cc && !out.includes(cc)) out.push(cc);
  }

  // Last resort so we always have a usable secondary.
  if (out.length < 2 && meaningful.length >= 1) {
    const alt = meaningful[meaningful.length - 1];
    if (alt && alt !== primary) out.push(alt);
  }

  return out.slice(0, max);
}
