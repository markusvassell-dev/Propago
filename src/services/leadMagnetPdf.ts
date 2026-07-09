import PDFDocument from 'pdfkit';
import { env } from '../config/env';
import { query } from '../db/pool';

// Lead-magnet PDF — rendered in-process (ported from the retired Replit
// generator) and stored in Postgres (lead_magnets, BYTEA). Served publicly by
// this app at GET /magnets/:id.pdf, so links embedded in published posts and
// emails keep working across redeploys (Railway's filesystem is ephemeral).

export interface LeadMagnetContent {
  name: string;
  subtitle: string;
  sections: Array<{ heading: string; items: string[] }>;
  cta: string;
}

export function renderMagnetPdf(magnet: LeadMagnetContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 60, right: 60 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 120; // content width

    // Cover
    doc.rect(0, 0, doc.page.width, 6).fill('#1E3A5F');
    doc.moveDown(6);
    doc.fillColor('#1E3A5F').font('Helvetica-Bold').fontSize(30).text(magnet.name, { width: W });
    doc.moveDown(0.5);
    doc.fillColor('#444444').font('Helvetica').fontSize(14).text(magnet.subtitle || '', { width: W });
    doc.moveDown(2);
    doc.fillColor('#888888').fontSize(10).text('A free resource — keep it with your management accounts.', { width: W });

    // Sections
    (magnet.sections || []).forEach((sec) => {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 6).fill('#1E3A5F');
      doc.moveDown(1);
      doc.fillColor('#1E3A5F').font('Helvetica-Bold').fontSize(18).text(sec.heading, { width: W });
      doc.moveDown(0.8);
      (sec.items || []).forEach((item) => {
        const y = doc.y;
        doc.lineWidth(1.2).strokeColor('#1E3A5F').rect(doc.x, y + 2, 9, 9).stroke(); // checkbox
        doc
          .fillColor('#222222')
          .font('Helvetica')
          .fontSize(11)
          .text(item, doc.x + 20, y, { width: W - 20, lineGap: 2 });
        doc.x -= 20;
        doc.moveDown(0.8);
      });
    });

    // CTA
    if (magnet.cta) {
      doc.moveDown(2);
      const y = doc.y;
      doc.rect(doc.x - 12, y - 10, W + 24, 74).fill('#F0F4F8');
      doc.fillColor('#1E3A5F').font('Helvetica-Bold').fontSize(12).text('Next step', doc.x, y, { width: W });
      doc.moveDown(0.3);
      doc.fillColor('#333333').font('Helvetica').fontSize(11).text(magnet.cta, { width: W });
    }

    doc.end();
  });
}

/** Render the PDF, persist it, and return the public URL this app serves it at. */
export async function storeLeadMagnet(
  runId: string | null,
  magnet: LeadMagnetContent
): Promise<{ url: string; name: string }> {
  const pdf = await renderMagnetPdf(magnet);
  const { rows } = await query<{ id: string }>(
    'INSERT INTO lead_magnets (workflow_run_id, name, pdf) VALUES ($1, $2, $3) RETURNING id',
    [runId, magnet.name, pdf]
  );
  return { url: `${env.publicBaseUrl}/magnets/${rows[0].id}.pdf`, name: magnet.name };
}
