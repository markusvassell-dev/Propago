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
// hero meta line, footer CTA band.
//
// TAGS AND CATEGORY are sent as real WordPress terms, not markup. The tag row
// and social-share buttons that close every hand-written post are theme output
// driven by the taxonomy, so a generated post only ends the same way if the
// terms are actually assigned. The category also feeds the theme's
// "In {Category} • {Date} • {N} Minutes" hero line and the permalink.
// Featured image still has to be set in WP admin (or via `featured_media`).
// Retries/backoff are BullMQ's job — this adapter throws clean errors.

export class WordPressAdapter implements CmsPublisher {
  readonly name = 'wordpress';

  private authHeader(): string {
    const token = Buffer.from(`${env.wordpress.username}:${env.wordpress.appPassword}`).toString('base64');
    return `Basic ${token}`;
  }

  /**
   * Turns term NAMES into the term IDs the REST API requires, creating any that
   * don't exist yet. Assigning real terms is what makes the theme render its
   * native tag row and social-share buttons beneath the post — those are theme
   * output driven by the taxonomy, not markup we could put in the body.
   *
   * Best-effort: a term that can't be resolved or created is skipped rather
   * than failing the publish. A post with one missing tag is still a good post.
   */
  private async resolveTerms(taxonomy: 'tags' | 'categories', names: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      try {
        const found = await axios.get(`${env.wordpress.baseUrl}/wp-json/wp/v2/${taxonomy}`, {
          params: { search: name, per_page: 100 },
          headers: { Authorization: this.authHeader() },
          timeout: 15_000
        });
        const hit = (found.data as Array<{ id: number; name: string }>).find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        );
        if (hit) {
          ids.push(hit.id);
          continue;
        }
        const created = await axios.post(
          `${env.wordpress.baseUrl}/wp-json/wp/v2/${taxonomy}`,
          { name },
          { headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' }, timeout: 15_000 }
        );
        ids.push(created.data.id);
      } catch (err) {
        const e = err as { response?: { data?: { data?: { term_id?: number } } } };
        // WP returns 400 term_exists with the existing id when a search miss
        // races a create — reuse it instead of dropping the term.
        const existing = e.response?.data?.data?.term_id;
        if (existing) ids.push(existing);
        else console.warn(`[wordpress] could not resolve ${taxonomy} "${name}" (skipped):`, (err as Error).message);
      }
    }
    return ids;
  }

  async publishPost(input: {
    title: string;
    markdown: string;
    metaDescription: string;
    leadMagnetUrl: string;
    existingPostId?: string;
    topicSlugSource?: string; // slug derives from the TOPIC (spec §2 slug rule), not the title
    tags?: string[];          // become real WP terms → theme renders its tag row + share buttons
    category?: string;
    leadMagnetName?: string;
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
    const content = html + magnetCta(input.leadMagnetUrl, input.leadMagnetName);

    const base = `${env.wordpress.baseUrl}/wp-json/wp/v2/posts`;
    const url = input.existingPostId ? `${base}/${input.existingPostId}` : base;

    // Resolved before the post is created so the terms are attached from the
    // start — the theme's tag row and share buttons render off these.
    const tags = input.tags?.length ? await this.resolveTerms('tags', input.tags) : [];
    const categories = input.category ? await this.resolveTerms('categories', [input.category]) : [];

    const res = await axios.post(
      url,
      {
        title: input.title,
        content,
        excerpt: input.metaDescription,
        ...(tags.length ? { tags } : {}),
        ...(categories.length ? { categories } : {}),
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

/**
 * The in-post route to the lead magnet, and the ONLY one an organic search
 * visitor has — ads and email only reach people already in the funnel. It was
 * a bare <hr /> plus one sentence, which read as tacked on after the article;
 * this is the same link presented as a deliberate block, using the theme's own
 * palette (greige panel, muted-green rule, copper button) so it looks native
 * rather than pasted in.
 */
function magnetCta(url: string, name?: string): string {
  const label = (name ?? '').trim() || 'the checklist';
  return [
    '',
    '<div class="propago-magnet-cta" style="background:#F4F1EC;border-left:4px solid #597363;padding:22px 26px;margin:34px 0">',
    '  <p style="margin:0 0 6px;font-weight:700;color:#3C4C3C;letter-spacing:.03em">FREE DOWNLOAD</p>',
    `  <p style="margin:0 0 16px;color:#3F3A3B">${escapeHtml(label)} — the checklist our advisory team works through with clients.</p>`,
    `  <a href="${escapeAttr(url)}" style="display:inline-block;background:#BC7C54;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.05em;padding:12px 22px">GET THE CHECKLIST (PDF)</a>`,
    '</div>'
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 5).join('-');
}
