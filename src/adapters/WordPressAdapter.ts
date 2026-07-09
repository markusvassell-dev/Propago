import axios from 'axios';
import { env } from '../config/env';
import { CmsPublisher, CmsPublishResult } from './types';
import { renderElementThemeHtml } from '../services/blogHtml';

// WordPress adapter (default CmsPublisher). Uses the REST API with an
// Application Password (Users → Profile → Application Passwords).
// Posts land inside the site's EXISTING Element Accounting theme at
// elementaccounting.ca/blog/ (rule 12): the adapter ships clean semantic
// markup (h2 headings, ul lists, figures) via renderElementThemeHtml and the
// theme supplies all styling — Arial type, greige background, green headings,
// hero meta line, footer CTA band. Set the post's category + featured image
// in WP admin (or extend the payload with `categories`/`featured_media`) —
// the theme's "In {Category} • {Date} • {N} Minutes" line reads from them.
// Retries/backoff are BullMQ's job — this adapter throws clean errors.

export class WordPressAdapter implements CmsPublisher {
  readonly name = 'wordpress';

  private authHeader(): string {
    const token = Buffer.from(`${env.wordpress.username}:${env.wordpress.appPassword}`).toString('base64');
    return `Basic ${token}`;
  }

  async publishPost(input: {
    title: string;
    markdown: string;
    metaDescription: string;
    leadMagnetUrl: string;
    existingPostId?: string;
  }): Promise<CmsPublishResult> {
    if (!env.wordpress.baseUrl) {
      // Structural stub for local dev: log the exact payload we would send.
      console.info('[wordpress:stub] would publish', {
        title: input.title,
        excerpt: input.metaDescription,
        contentBytes: input.markdown.length
      });
      return {
        liveUrl: `https://elementaccounting.ca/blog/${slugify(input.title)}/`,
        cmsPostId: `stub_${Date.now()}`,
        leadMagnetUrl: input.leadMagnetUrl
      };
    }

    const html = renderElementThemeHtml(input.markdown);
    // CTA block linking the lead magnet is appended to the post body itself.
    const content =
      html +
      `\n<hr />\n<p><strong>Free download:</strong> <a href="${input.leadMagnetUrl}">Get the checklist (PDF)</a></p>`;

    const base = `${env.wordpress.baseUrl}/wp-json/wp/v2/posts`;
    const url = input.existingPostId ? `${base}/${input.existingPostId}` : base;

    const res = await axios.post(
      url,
      {
        title: input.title,
        content,
        excerpt: input.metaDescription,
        status: 'publish'
      },
      {
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        timeout: 20_000,
        // Surface non-2xx as throws with the verbatim body (shown in the
        // dashboard audit modal, e.g. "502 Bad Gateway").
        validateStatus: (s) => s >= 200 && s < 300
      }
    );

    return {
      liveUrl: res.data.link,
      cmsPostId: String(res.data.id),
      // The magnet stays on the generator's public URL; sideload into WP Media
      // here instead if you need same-origin hosting.
      leadMagnetUrl: input.leadMagnetUrl
    };
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 6).join('-');
}
