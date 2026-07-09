'use strict';

// NexusFlow content generator — runs on Replit, called by the Railway backend.
//
// Contract (must match handoff/src/adapters/ReplitGenerationAdapter.ts):
//   POST /api/generate
//   Header:  Authorization: Bearer <REPLIT_SERVICE_SECRET>
//   Body:    { topic, keywords, tone, brandVoice, revisionNote }
//   200:     { blogTitle, metaDescription, blogMarkdown (1000+ words),
//              leadMagnetUrl (public PDF URL), leadMagnetName }
//   401/403: bad bearer token   ·   5xx: generation failure (caller retries 3×)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');

const PORT = parseInt(process.env.PORT || '3000', 10);
const SERVICE_SECRET = process.env.REPLIT_SERVICE_SECRET || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MIN_WORDS = 1000; // the caller rejects anything shorter

if (!SERVICE_SECRET) console.warn('[boot] REPLIT_SERVICE_SECRET not set — all requests will be 401');
if (!process.env.OPENAI_API_KEY) console.warn('[boot] OPENAI_API_KEY not set — generation will fail');

const openai = new OpenAI(); // reads OPENAI_API_KEY from env

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------- PDF hosting
const MAGNET_DIR = path.join(__dirname, 'public', 'magnets');
fs.mkdirSync(MAGNET_DIR, { recursive: true });
app.use('/magnets', express.static(MAGNET_DIR, { maxAge: '365d', immutable: true }));

// Health check (also lets you confirm the deploy URL in a browser)
app.get('/', (_req, res) => res.json({ ok: true, service: 'nexus-generator', model: MODEL }));

// ------------------------------------------------------------------ auth
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(SERVICE_SECRET);
  const ok = SERVICE_SECRET.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'invalid bearer token' });
  next();
}

// ------------------------------------------------------------------ prompts
function systemPrompt(brandVoice) {
  return [
    'You are the senior content writer for a UK financial advisory firm serving under-served niches (health & safety consultancies and similar SME sectors).',
    brandVoice ? `BRAND VOICE — follow it exactly in all copy:\n${brandVoice}` : '',
    'Business-focused, practical, zero fluff. UK English. No exclamation marks. No emoji.',
    '',
    'Return STRICT JSON with exactly these keys:',
    '{',
    '  "blogTitle": string,                       // compelling, ≤ 70 chars',
    '  "metaDescription": string,                 // ≤ 155 chars',
    `  "blogMarkdown": string,                    // the FULL post in Markdown, MINIMUM ${MIN_WORDS + 200} words, H2/H3 headings, keywords woven in naturally, ends with a short CTA to download the lead magnet`,
    '  "leadMagnet": {',
    '    "name": string,                          // e.g. "The H&S Consultancy Cash-Flow Checklist" — ends with a format word like Checklist/Guide/Toolkit',
    '    "subtitle": string,                      // one line',
    '    "sections": [ { "heading": string, "items": [string, ...] } ],  // 3-5 sections, 4-6 actionable items each, full sentences',
    '    "cta": string                            // 1-2 sentence closing call to action for the firm',
    '  }',
    '}'
  ].filter(Boolean).join('\n');
}

function userPrompt({ topic, keywords, tone, revisionNote }) {
  const kw = Array.isArray(keywords) ? keywords.join(', ') : String(keywords || '');
  return [
    `Topic: ${topic}`,
    kw ? `Target keywords: ${kw}` : '',
    tone ? `Tone: ${tone}` : '',
    revisionNote ? `A human reviewer rejected the previous draft with this note — address it fully:\n${revisionNote}` : ''
  ].filter(Boolean).join('\n');
}

async function completeJSON(messages) {
  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4096,
    messages
  });
  return JSON.parse(res.choices[0].message.content);
}

const wordCount = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

// ------------------------------------------------------------------ PDF
function renderMagnetPdf(magnet, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 60, right: 60 } });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);

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
        doc.fillColor('#222222').font('Helvetica').fontSize(11)
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
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// ------------------------------------------------------------------ endpoint
app.post('/api/generate', auth, async (req, res) => {
  const started = Date.now();
  const { topic, keywords, tone, brandVoice, revisionNote } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'missing "topic"' });

  try {
    const messages = [
      { role: 'system', content: systemPrompt(brandVoice) },
      { role: 'user', content: userPrompt({ topic, keywords, tone, revisionNote }) }
    ];
    let out = await completeJSON(messages);

    // The caller hard-rejects < 1000 words — expand once if the model came up short.
    if (wordCount(out.blogMarkdown) < MIN_WORDS) {
      console.log(`[generate] post was ${wordCount(out.blogMarkdown)} words — expanding`);
      const expanded = await completeJSON([
        { role: 'system', content: systemPrompt(brandVoice) },
        {
          role: 'user',
          content:
            `Expand the following blog post to at least ${MIN_WORDS + 300} words. Keep the structure and voice; deepen each section with concrete, practical detail. ` +
            `Return STRICT JSON: { "blogMarkdown": string }\n\n${out.blogMarkdown}`
        }
      ]);
      if (wordCount(expanded.blogMarkdown) > wordCount(out.blogMarkdown)) out.blogMarkdown = expanded.blogMarkdown;
    }

    // Render + host the lead-magnet PDF
    const magnet = out.leadMagnet || { name: `${topic} Checklist`, subtitle: '', sections: [], cta: '' };
    const file = `${slugify(magnet.name || topic)}-${crypto.randomBytes(4).toString('hex')}.pdf`;
    await renderMagnetPdf(magnet, path.join(MAGNET_DIR, file));

    const body = {
      blogTitle: out.blogTitle || topic,
      metaDescription: out.metaDescription || '',
      blogMarkdown: out.blogMarkdown,
      leadMagnetUrl: `${publicBase(req)}/magnets/${file}`,
      leadMagnetName: magnet.name || 'Lead magnet PDF'
    };
    console.log(`[generate] ok in ${Date.now() - started}ms — ${wordCount(body.blogMarkdown)} words, ${file}`);
    res.json(body);
  } catch (err) {
    // Clean 502 so the Railway side's BullMQ retry policy (3×, exponential) kicks in.
    console.error('[generate] failed:', err);
    res.status(502).json({ error: String((err && err.message) || err) });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`nexus-generator listening on 0.0.0.0:${PORT}`));
