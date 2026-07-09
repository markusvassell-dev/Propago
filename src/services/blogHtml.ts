// Blog HTML renderer — Element Accounting theme contract (CLAUDE.md rule 12).
//
// Generated posts publish INTO the site's existing WordPress theme at
// elementaccounting.ca/blog/, so this renderer's job is clean semantic
// structure, not styling. The theme supplies: Arial headings/body, warm greige
// page background (#E1DBD6), muted-green section headings (#597363), the white
// header with the copper (#BC7C54) "LET'S WORK TOGETHER" button, the hero with
// overlaid title + "In {Category} • {Date} • {N} Minutes" meta, justified
// ~700px text column (~1.8 line-height), and the dark-green (#3C4C3C) footer
// CTA band. The dashboard's draft preview mirrors that rendering 1:1 — if a
// draft looks right in the review queue, it will look right on the live site.
//
// Structural contract the generator's markdown is expected to follow (and the
// SEO scorer checks): H2 section headings (the theme colors them green;
// convention is a trailing colon, e.g. "## Why this matters:"), bullet lists
// as `-` items, full-width inline images between sections, 1000+ words.

export function renderElementThemeHtml(md: string): string {
  const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const html: string[] = [];

  for (const block of blocks) {
    // Headings
    const h = block.match(/^(#{1,3})\s+(.+)$/m);
    if (h && block.startsWith(h[1])) {
      const level = Math.max(2, h[1].length); // never emit an H1 — the theme's hero owns the title
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      const rest = block.slice(h[0].length).trim();
      if (rest) html.push(paragraphOrList(rest));
      continue;
    }
    html.push(paragraphOrList(block));
  }
  return html.join('\n');
}

function paragraphOrList(block: string): string {
  const lines = block.split('\n');

  // Unordered list (theme renders disc bullets)
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    const items = lines.map((l) => `  <li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`);
    return `<ul>\n${items.join('\n')}\n</ul>`;
  }
  // Ordered list
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    const items = lines.map((l) => `  <li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
    return `<ol>\n${items.join('\n')}\n</ol>`;
  }
  // Standalone image → full-width figure between sections (theme styles it)
  const img = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (img) {
    return `<figure class="wp-block-image size-full"><img src="${img[2]}" alt="${escapeAttr(img[1])}" /></figure>`;
  }
  return `<p>${inline(block.replace(/\n/g, '<br />'))}</p>`;
}

/** Inline markdown: images, links, bold, italic. */
function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
