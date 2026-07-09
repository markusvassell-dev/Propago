import { Router, Request, Response } from 'express';
import { query } from '../db/pool';

// Public lead-magnet PDFs — NO auth: these links go out in published posts,
// emails and the Karbon completion note. Immutable content → long cache.

export const magnetsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

magnetsRouter.get('/:id.pdf', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'not_found' });

    const { rows } = await query<{ name: string; pdf: Buffer }>(
      'SELECT name, pdf FROM lead_magnets WHERE id = $1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${rows[0].name.replace(/[^\w .-]+/g, '').trim() || 'lead-magnet'}.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].pdf);
  } catch (err) {
    console.error('[magnets]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});
