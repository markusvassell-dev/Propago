import axios from 'axios';
import { env } from '../config/env';
import { CmsPublisher, CmsPublishResult } from './types';
import { renderElementThemeHtml } from '../services/blogHtml';

// WordPress adapter (default CmsPublisher). Uses the REST API with an
// Application Password (Users → Profile → Application Passwords).
//
// TWO-STEP PUBLISH: publishPost() creates the post as a DRAFT so the reviewer
// at gate ① previews it inside the real Element Accounting theme rather than
// judging raw markdown; approving calls publishLive() to flip that same post
// to status=publish. Nothing is publicly reachable before a human approves.
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
    topicSlugSource?: string; // slug derives from the TOPIC (spec §2 slug rule), not the title
  }): Promise<CmsPublishResult> {
    if (!env.wordpress.baseUrl) {
      // Structural stub for local dev: log the exact payload we would send.
      console.info('[wordpress:stub] would create draft', {
        title: input.title,
        excerpt: input.metaDescription,
        contentBytes: input.markdown.length
      });
      const id = `stub_${Date.now()}`;
      return {
        liveUrl: `https://elementaccounting.ca/blog/${slugify(input.topicSlugSource || input.title)}`,
        cmsPostId: id,
        leadMagnetUrl: input.leadMagnetUrl,
        previewUrl: `https://elementaccounting.ca/?p=${id}&preview=true`
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
        // DRAFT, not publish — gate ① approval flips it via publishLive().
        status: 'draft'
      },
      {
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        timeout: 20_000,
        // Surface non-2xx as throws with the verbatim body (shown in the
        // dashboard audit modal, e.g. "502 Bad Gateway").
        validateStatus: (s) => s >= 200 && s < 300
      }
    );

    const id = String(res.data.id);
    return {
      // `link` on a draft is the slug it WILL have once published — good enough
      // for the archive record; publishLive() overwrites it with the real one.
      liveUrl: res.data.link,
      cmsPostId: id,
      // The magnet stays on the generator's public URL; sideload into WP Media
      // here instead if you need same-origin hosting.
      leadMagnetUrl: input.leadMagnetUrl,
      previewUrl: `${env.wordpress.baseUrl}/?p=${id}&preview=true`
    };
  }

  /**
   * Flips a draft created by publishPost() to status=publish. Separate call so
   * the reviewer's approval is what makes the post public — see gate ① in
   * src/saga/stages.ts.
   */
  async publishLive(postId: string): Promise<{ liveUrl: string }> {
    if (!env.wordpress.baseUrl) {
      console.info('[wordpress:stub] would publish live', { postId });
      return { liveUrl: `https://elementaccounting.ca/blog/${postId}` };
    }
    const res = await axios.post(
      `${env.wordpress.baseUrl}/wp-json/wp/v2/posts/${postId}`,
      { status: 'publish' },
      {
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        timeout: 20_000,
        validateStatus: (s) => s >= 200 && s < 300
      }
    );
    return { liveUrl: res.data.link };
  }

  /**
   * Moves a post to the WordPress trash. Used to clean up the draft when a run
   * is rejected at gate ① — otherwise every rejected run leaves an orphan draft
   * behind, three per Karbon trigger.
   */
  async trashPost(postId: string): Promise<void> {
    if (!env.wordpress.baseUrl) {
      console.info('[wordpress:stub] would trash', { postId });
      return;
    }
    await axios.delete(`${env.wordpress.baseUrl}/wp-json/wp/v2/posts/${postId}`, {
      headers: { Authorization: this.authHeader() },
      timeout: 20_000,
      validateStatus: (s) => s >= 200 && s < 300
    });
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 5).join('-');
}
