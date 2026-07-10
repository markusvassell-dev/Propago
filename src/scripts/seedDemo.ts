import 'dotenv/config';
import { Pool } from 'pg';
import PDFDocument from 'pdfkit';

// Demo seed (DESIGN_SPEC §13.11): reproduces the prototype's four showcase
// runs so the first boot looks exactly like the design reference —
//   WF-1038 (complete, partial social + IG 190 error + full artifacts)
//   WF-1039 (failed deploy, 502 error body, Karbon "Workflow Failed" note)
//   WF-1040 (in review, SEO 84: kw 78/read 88/head 92/meta 71, 1 auto-SEO loop)
//   WF-1041 (running at Generate)
// plus the registry rows, 4 captured leads and lead-magnet PDFs. Connection
// statuses (IG expired) are seeded by db/schema.sql. Idempotent: skips when
// WF-1038 already exists. Usage: npm run db:seed-demo

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

const M = 60_000;
const now = Date.now();
const at = (minAgo: number): Date => new Date(now - minAgo * M);

type St = { status: string; attempts: number; ms: number; note: string; err?: string };
const pend = (): St => ({ status: 'pending', attempts: 1, ms: 0, note: '' });
const mkStages = (): St[] => Array.from({ length: 12 }, pend);

// ---- prototype fullPost() body, rendered to markdown ----
function blogBody(meta: string, pain: string): string {
  const p = pain.replace(/\.$/, '');
  const sections: Array<[string, string[]]> = [
    [
      'Where the money actually leaks:',
      [
        `Start with the concentration problem: ${p.toLowerCase()}. When most revenue arrives as one-off engagements, every quiet month becomes a cash-flow event rather than a rounding error.`,
        'Map the last twelve months of income by service line and by client. Anything above 40% concentration in a single line — or a single client — is a risk to price and diversify against, not a strength to lean on.'
      ]
    ],
    [
      'Retainer pricing: three bands that work:',
      [
        'Convert repeatable work into fixed monthly retainers banded by risk and demand cycle, not by headcount or hours. A three-band structure lets clients self-select and stabilises your baseline.',
        'Set the floor band to cover your fixed costs in a quiet month, and add an annual review clause tied to CPI so pricing keeps pace without an awkward renegotiation each year.'
      ]
    ],
    [
      'Sizing a cash buffer to demand cycles:',
      [
        'Hold a buffer equal to roughly three months of fixed costs, sized to your specific enforcement or seasonal cycle rather than a generic rule of thumb.',
        'Fund it automatically: move a fixed percentage of every invoice into a separate reserve on receipt, before it ever feels spendable.'
      ]
    ],
    [
      'Reliefs most firms leave on the table:',
      [
        'Method development, testing and process improvement frequently qualify for R&D relief that goes unclaimed because it is filed as routine delivery. Track the time and cost against the qualifying-activity test as you go, not at year-end.',
        'Pair this with a simple point-of-invoice tax set-aside so a healthy year never turns into a January cash shock.'
      ]
    ],
    [
      'Your next 90 days:',
      [
        'Pick three moves from the checklist below, assign an owner and a date, and review them at the end of the quarter. Small, boring and compounding — that is the whole game.',
        'The downloadable checklist that ships with this post turns each of these into a concrete step you can tick off with your accountant.'
      ]
    ]
  ];
  let md = `${meta}\n\nMost firms in this position deliver excellent technical work but run on unpredictable cash. The fix is structural, not heroic — a handful of pricing, buffer and relief decisions that compound over a year. Everything below is written to be actioned this quarter.\n\n`;
  for (const [h, paras] of sections) md += `## ${h}\n\n${paras.join('\n\n')}\n\n`;
  return md.trim();
}

// ---- prototype magnetItems() checklist sets ----
const MAGNET_ITEMS: Record<string, string[]> = {
  'R&D Relief': [
    'List every product or process you improved in the last two years',
    'Separate routine testing from genuine method development',
    'Log staff time spent resolving technical uncertainty',
    'Capture subcontractor and consumable costs tied to that work',
    'Cross-check each activity against HMRC’s qualifying-activity test'
  ],
  'Retainer Pricing': [
    'Map each client to a fixed monthly scope, not ad-hoc hours',
    'Band pricing by enforcement-cycle risk, not headcount',
    'Set a floor price that covers quiet-season fixed costs',
    'Add an annual review clause tied to CPI',
    'Model cash flow at 60%, 80% and 100% retainer conversion'
  ],
  'Financial Health': [
    'Split revenue by service line — flag anything above 40% concentration',
    'Confirm a three-month fixed-cost cash buffer for quiet months',
    'Review invoices overdue by more than 45 days',
    'Check VAT scheme and flat-rate eligibility before year-end',
    'Set tax aside at the point of invoice, not at year-end'
  ]
};

function magnetPdf(name: string, items: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 60, right: 60 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 120;
    doc.rect(0, 0, doc.page.width, 6).fill('#1E3A5F');
    doc.moveDown(4);
    doc.fillColor('#8a8578').font('Helvetica').fontSize(9).text('ELEMENT ACCOUNTING · CLIENT RESOURCE', { width: W });
    doc.moveDown(0.6);
    doc.fillColor('#1E3A5F').font('Helvetica-Bold').fontSize(26).text(name, { width: W });
    doc.moveDown(1.2);
    items.forEach((item, i) => {
      doc
        .fillColor('#137a5b')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(String(i + 1).padStart(2, '0'), { continued: true, width: W })
        .fillColor('#222222')
        .font('Helvetica')
        .text(`   ${item}`, { width: W });
      doc.moveDown(0.7);
    });
    doc.moveDown(1);
    doc.fillColor('#888888').fontSize(9).text('+ 7 more items · delivered as a downloadable PDF on sign-up', { width: W });
    doc.end();
  });
}

const hash64 = (h12: string): string => (h12.repeat(6) + h12).slice(0, 64);

async function main(): Promise<void> {
  const dup = await pool.query(`SELECT 1 FROM workflow_runs WHERE run_no = 1038`);
  if (dup.rows.length) {
    console.info('[seed-demo] WF-1038 already present — skipping (idempotent)');
    await pool.end();
    return;
  }

  const users = await pool.query<{ id: string; email: string }>(`SELECT id, email FROM users`);
  const uid = (email: string): string | null => users.rows.find((u) => u.email.startsWith(email))?.id ?? null;
  const mercer = uid('jmercer');

  interface SeedRun {
    runNo: number;
    kb: string;
    topic: string;
    client: string;
    keywords: string[];
    status: string;
    step: string;
    createdAgo: number;
    updatedAgo: number;
    pain: string;
    source: string;
    lev: number;
    seoLoops?: number;
    seo?: { total: number; kw: number; read: number; head: number; meta: number; sugs: string[] };
    stages: St[];
    artifacts: Record<string, string>;
    error?: Record<string, unknown>;
    approvedBy?: string | null;
    draft?: { title: string; meta: string; magnet: string; words: number; status: string; liveUrl?: string };
    dist?: boolean;
    distEditedEmail?: boolean;
    audits: Array<[number, string, string]>; // [minAgo, who, msg]
    magnetSet?: string;
  }

  // ---------- WF-1041 — running at Generate ----------
  const s41 = mkStages();
  s41[0] = { status: 'done', attempts: 1, ms: 240, note: 'Karbon webhook verified (HMAC ✓) — topic, keywords, tone extracted' };
  s41[1] = { status: 'done', attempts: 1, ms: 3400, note: 'Web search + ChatGPT pain-point extraction · Levenshtein 0.38 vs nearest — unique, saved to research registry' };
  s41[2] = { ...pend(), status: 'active' };

  // ---------- WF-1040 — awaiting review ----------
  const s40 = mkStages();
  [240, 3800, 4600, 1100].forEach((ms, i) => (s40[i] = { status: 'done', attempts: 1, ms, note: '' }));
  s40[0].note = 'Karbon webhook verified (HMAC ✓) — topic, keywords, tone extracted';
  s40[1].note = 'Web search + ChatGPT pain-point extraction · Levenshtein 0.38 vs nearest — unique, saved to research registry';
  s40[2].note = 'ChatGPT Business API 200 OK in 41s — 1,264-word post + lead magnet URL parsed · draft persisted (status: draft)';
  s40[2].attempts = 2; // one auto-SEO loop regeneration
  s40[3].note = 'SEO 84/100 ≥ threshold 80 · 3 suggestions · passed after 1 auto-loop';
  s40[4] = { ...pend(), status: 'gate' };

  // ---------- WF-1039 — failed at deploy ----------
  const s39 = mkStages();
  [220, 3600, 4400, 1000, 480000].forEach((ms, i) => (s39[i] = { status: 'done', attempts: 1, ms, note: '' }));
  s39[0].note = 'Karbon webhook verified (HMAC ✓) — topic, keywords, tone extracted';
  s39[1].note = 'Web search + ChatGPT pain-point extraction · Levenshtein 0.41 vs nearest — unique, saved to research registry';
  s39[2].note = 'ChatGPT Business API 200 OK in 47s — 1,312-word post + LinkedIn/FB/IG + lead magnet · registry: SHA-256 + TF-IDF unique';
  s39[3].note = 'SEO 88/100 ≥ threshold 80 · 1 suggestion';
  s39[5] = {
    status: 'failed',
    attempts: 3,
    ms: 14200,
    note: 'POST /wp-json/wp/v2/posts → 502 Bad Gateway ×3 · backoff exhausted (2s → 4s → 8s) · parked · “Workflow Failed” posted to Karbon timeline',
    err: 'POST https://elementaccounting.ca/wp-json/wp/v2/posts → HTTP 502 Bad Gateway\n{"code":"http_502","message":"upstream timed out (edge-cache)","request_id":"wp_7f31c2"}\nattempt 1 → 502 · attempt 2 (+2s) → 502 · attempt 3 (+4s) → 502 — retries exhausted · parked · "Workflow Failed" → Karbon timeline'
  };

  // ---------- WF-1038 — complete (partial social) ----------
  const s38 = mkStages();
  [230, 3700, 4800, 950, 1260000, 2600, 3100, 540000, 2900, 1700, 2400, 400].forEach(
    (ms, i) => (s38[i] = { status: 'done', attempts: 1, ms, note: '' })
  );
  s38[0].note = 'Karbon webhook verified (HMAC ✓) — topic, keywords, tone extracted';
  s38[1].note = 'Web search + ChatGPT pain-point extraction · Levenshtein 0.29 vs nearest — unique, saved to research registry';
  s38[2].note = 'ChatGPT Business API 200 OK in 52s — 1,342-word post + LinkedIn/FB/IG + lead magnet · registry: SHA-256 + TF-IDF unique';
  s38[3].note = 'SEO 88/100 ≥ threshold 80 · 0 suggestions';
  s38[5].note = 'POST /wp-json/wp/v2/posts → 201 Created · live URL stored';
  s38[6].note = 'Ad creative, campaign email + 3 platform captions generated from the approved post';
  s38[7].note = 'Approved & published by j.mercer · overrides: email';
  s38[8].note = 'LEADGEN campaign + ad set + creative created in sandbox → ActiveCampaign sign-up form';
  s38[9].note = 'Campaign queued — 1,842 subscribers + ad-leads segment · magnet link + post teaser';
  s38[10] = {
    status: 'partial',
    attempts: 1,
    ms: 2400,
    note: 'LinkedIn ✓ · Facebook ✓ · Instagram ✕ (token expired) — non-blocking, flagged in Connections',
    err: 'POST graph.facebook.com/v19.0/17845/media_publish → HTTP 400\n{"error":{"type":"OAuthException","code":190,"message":"Error validating access token: session has expired"}}\nnon-blocking — LinkedIn ✓ Facebook ✓ · reconnect Instagram in Connections'
  };
  s38[11].note = 'Karbon Timeline API: note posted to KB-2208 — links + completion summary (custom fields untouched)';

  const runs: SeedRun[] = [
    {
      runNo: 1041,
      kb: 'KB-2214',
      topic: 'Cash flow forecasting for occupational health providers',
      client: 'Halcyon Occupational Health',
      keywords: ['cash flow forecast', 'occupational health finance', 'revenue planning'],
      status: 'generating',
      step: 'generation',
      createdAgo: 3,
      updatedAgo: 0.4,
      pain: 'Occupational health providers can’t forecast cash flow across variable contract cycles',
      source: 'NHS framework changes + provider forum threads',
      lev: 0.31,
      stages: s41,
      artifacts: {},
      audits: [
        [3, 'system', 'Run created — Karbon stage “Marketing Content — Ready”'],
        [2.85, 'api', 'Karbon webhook verified (HMAC ✓) — payload parsed'],
        [2, 'api', 'ChatGPT Business API: chat.completions dispatched · awaiting response (timeout 90s)']
      ]
    },
    {
      runNo: 1040,
      kb: 'KB-2211',
      topic: 'Financial planning for health & safety consultancies',
      client: 'Sentinel Safety Group',
      keywords: ['health & safety consultancy finance', 'retainer pricing', 'R&D tax relief'],
      status: 'seo_review',
      step: 'review',
      createdAgo: 26,
      updatedAgo: 14,
      pain: 'H&S consultancies run on volatile project income, no retainer base',
      source: 'Trade press + consultancy owner interviews',
      lev: 0.33,
      seoLoops: 1,
      seo: {
        total: 84,
        kw: 78,
        read: 88,
        head: 92,
        meta: 71,
        sugs: [
          'Meta description is 172 chars — trim to ≤155 so it doesn’t truncate.',
          'Keyword density 0.8% — target 1–1.5% for “health & safety consultancy finance”.',
          'Add an internal link to the services page in the closing section.'
        ]
      },
      stages: s40,
      artifacts: {},
      draft: {
        title: 'Financial Planning for Health & Safety Consultancies: The 2026 Guide',
        meta: 'How H&S consultancies stabilise cash flow, price retainers and claim R&D relief most firms never touch — with a downloadable 12-point financial health checklist.',
        magnet: 'H&S Consultancy Financial Health Checklist — 12-point PDF',
        words: 1264,
        status: 'draft'
      },
      magnetSet: 'Financial Health',
      audits: [
        [26, 'system', 'Run created — Karbon stage “Marketing Content — Ready”'],
        [25, 'api', 'Karbon webhook verified (HMAC ✓) — payload parsed'],
        [21, 'api', 'ChatGPT Business API: chat.completions · brand voice injected'],
        [16, 'api', 'ChatGPT Business API 200 OK in 41s — 1,264-word post + magnet URL parsed · draft persisted'],
        [14.2, 'system', 'SEO score 84/100 · 3 suggestions'],
        [14, 'system', 'Flagged “Ready for Accountant Revi” — paused for human review (threshold 80, auto-approve off)']
      ]
    },
    {
      runNo: 1039,
      kb: 'KB-2209',
      topic: 'Pricing retainers for fire risk assessment firms',
      client: 'Bastion Risk Partners',
      keywords: ['fire risk assessment pricing', 'retainer model', 'recurring revenue'],
      status: 'failed',
      step: 'deploy',
      createdAgo: 64,
      updatedAgo: 41,
      pain: 'Fire-risk firms stuck on one-off audits, no recurring revenue',
      source: 'Regulator cycle data + broker commentary',
      lev: 0.41,
      seo: {
        total: 88,
        kw: 86,
        read: 90,
        head: 92,
        meta: 82,
        sugs: ['Add an internal link to the services page in the closing section.']
      },
      stages: s39,
      artifacts: { karbonNote: 'KB-2209 — “Workflow Failed” note on timeline' },
      error: {
        message: 'WordPress deploy failed: 502 Bad Gateway',
        httpStatus: 502,
        responseBody: s39[5].err,
        attempts: 3
      },
      approvedBy: mercer,
      draft: {
        title: 'Pricing Retainers for Fire Risk Assessment Firms: The 2026 Guide',
        meta: 'Move fire risk assessment work from one-off audits to recurring retainers — pricing bands, scope guards and renewal maths.',
        magnet: 'Retainer Pricing Worksheet — 12-point PDF',
        words: 1312,
        status: 'approved'
      },
      magnetSet: 'Retainer Pricing',
      audits: [
        [64, 'system', 'Run created — Karbon stage “Marketing Content — Ready”'],
        [58, 'api', 'ChatGPT Business API 200 OK in 47s — 1,312-word post + magnet URL parsed · draft persisted'],
        [56, 'system', 'SEO score 88/100 · 1 suggestion'],
        [48, 'j.mercer', 'Draft approved — content moves to deploy'],
        [44, 'api', 'POST /wp-json/wp/v2/posts → 502 Bad Gateway · retry 1/3 in 2s'],
        [43, 'api', 'Retry 2/3 → 502 Bad Gateway · backing off 4s'],
        [41, 'api', 'Retry 3/3 → 502 Bad Gateway · attempts exhausted — run parked as failed'],
        [40, 'api', 'Karbon Timeline API: “Workflow Failed — deploy exhausted 3 retries (502)” posted to KB-2209 · team notified'],
        [39, 'system', 'Automation Issue - Manual — WF-1039 parked after retries exhausted; flagged for manual intervention']
      ]
    },
    {
      runNo: 1038,
      kb: 'KB-2208',
      topic: 'R&D tax relief for safety equipment manufacturers',
      client: 'Northline Compliance',
      keywords: ['R&D tax relief', 'safety equipment manufacturing', 'innovation credit'],
      status: 'complete',
      step: 'done',
      createdAgo: 172,
      updatedAgo: 118,
      pain: 'Safety-equipment makers miss R&D relief on method development',
      source: 'HMRC R&D bulletin + manufacturer Q&A',
      lev: 0.29,
      seo: { total: 88, kw: 84, read: 91, head: 94, meta: 80, sugs: [] },
      stages: s38,
      artifacts: {
        blogUrl: 'elementaccounting.ca/blog/rd-tax-relief-safety-equipment',
        magnetUrl: 'elementaccounting.ca/downloads/rd-relief-checklist.pdf',
        adId: 'camp_2371 · adset_5488 · ad_9022 (sandbox)',
        campaignId: 'cmp_5493 — sent to 1,842 contacts',
        social: 'LinkedIn ✓ · Facebook ✓ · Instagram ✕',
        karbonNote: 'KB-2208 — timeline note posted (links + summary)'
      },
      approvedBy: mercer,
      draft: {
        title: 'R&D Tax Relief for Safety Equipment Manufacturers: The 2026 Guide',
        meta: 'Method development counts. How safety equipment makers claim R&D relief on testing rigs, materials and certification work.',
        magnet: 'R&D Relief Eligibility Checklist — 12-point PDF',
        words: 1342,
        status: 'published',
        liveUrl: 'https://elementaccounting.ca/blog/rd-tax-relief-safety-equipment'
      },
      dist: true,
      distEditedEmail: true,
      magnetSet: 'R&D Relief',
      audits: [
        [172, 'system', 'Run created — Karbon stage “Marketing Content — Ready”'],
        [165, 'api', 'ChatGPT Business API: chat.completions · brand voice injected'],
        [158, 'api', 'ChatGPT Business API 200 OK in 52s — 1,342-word post + magnet URL parsed · draft persisted'],
        [156, 'system', 'SEO score 88/100 · 2 suggestions'],
        [135, 'j.mercer', 'Draft approved — content moves to deploy'],
        [132, 'api', 'POST /wp-json/wp/v2/posts → 201 Created · live URL stored'],
        [131, 'api', 'GPT-4o: distribution payloads generated — ad creative, email, LinkedIn/FB/IG captions'],
        [130, 'j.mercer', 'Manual overrides saved — email'],
        [129, 'j.mercer', 'Distribution approved — publish jobs enqueued (meta-ads · activecampaign · social)'],
        [128, 'api', 'Meta: LEADGEN campaign + ad set + creative created (sandbox) → ActiveCampaign form'],
        [124, 'api', 'ActiveCampaign: campaign cmp_5493 sent — 1,842 subscribers + ad-leads segment'],
        [121, 'api', 'LinkedIn ✓ · Facebook ✓ · Instagram ✕ (token expired) — non-blocking'],
        [118, 'api', 'Karbon Timeline API: note posted to KB-2208 — links + completion summary'],
        [118, 'system', 'Workflow complete — all jobs succeeded (1 partial)']
      ]
    }
  ];

  const runIds: Record<number, string> = {};

  for (const r of runs) {
    const seoReport = r.seo
      ? { total: r.seo.total, kw: r.seo.kw, read: r.seo.read, head: r.seo.head, meta: r.seo.meta, sugs: r.seo.sugs }
      : null;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO workflow_runs
        (run_no, karbon_work_id, karbon_stage_id, client_name, topic, keywords, tone, status, current_step, batch_seq,
         pain_point, source_insight, levenshtein, seo_score, seo_report, seo_loops, stage_state, artifacts,
         approved_by, error, created_at, updated_at, completed_at)
       VALUES ($1,$2,'mkt-ready',$3,$4,$5,'Authoritative, plainspoken',$6::run_status,$7,1,
               $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        r.runNo,
        r.kb,
        r.client,
        r.topic,
        r.keywords,
        r.status,
        r.step,
        r.pain,
        r.source,
        r.lev,
        r.seo?.total ?? null,
        seoReport ? JSON.stringify(seoReport) : null,
        r.seoLoops ?? 0,
        JSON.stringify(r.stages),
        JSON.stringify(r.artifacts),
        r.approvedBy ?? null,
        r.error ? JSON.stringify(r.error) : null,
        at(r.createdAgo),
        at(r.updatedAgo),
        r.status === 'complete' ? at(r.updatedAgo) : null
      ]
    );
    const runId = rows[0].id;
    runIds[r.runNo] = runId;

    // lead magnet PDF + draft
    let magnetUrl: string | null = null;
    if (r.magnetSet && r.draft) {
      const pdf = await magnetPdf(r.draft.magnet, MAGNET_ITEMS[r.magnetSet]);
      const m = await pool.query<{ id: string }>(
        `INSERT INTO lead_magnets (workflow_run_id, name, pdf, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
        [runId, r.draft.magnet, pdf, at(r.updatedAgo)]
      );
      magnetUrl = `/magnets/${m.rows[0].id}.pdf`;
    }

    if (r.draft) {
      const body = blogBody(r.draft.meta, r.pain);
      let dist: Record<string, unknown> = {};
      if (r.dist) {
        const T = r.draft.title.replace(/: The 2026 Guide$/, '');
        const url = `https://${r.artifacts.blogUrl}`;
        const mag = `https://${r.artifacts.magnetUrl}`;
        const magName = r.draft.magnet.split(' — ')[0];
        const ads = {
          headline: `Free: ${magName}`.slice(0, 40),
          primaryText: 'Project income is volatile. Get the 12-point checklist our advisory team uses to stabilise cash flow — free download.',
          link: 'elementaccounting.activehosted.com/f/rd-tax-relief'
        };
        const emailOrig = {
          subject: `Your ${magName} (free download inside)`,
          body: `Hi {{ first_name }},\n\nNew on the blog: ${T}.\n\n${r.draft.meta}\n\nDownload the ${magName}:\n${mag}\n\nRead the full post:\n${url}\n\n— The Element Accounting team`
        };
        const email = {
          subject: emailOrig.subject,
          body: `Hi {{ first_name }},\n\nMethod development counts — and most safety equipment manufacturers never claim it.\n\n${r.draft.meta}\n\nDownload the ${magName}:\n${mag}\n\nRead the full post:\n${url}\n\n— The Element Accounting team`
        };
        const social = {
          linkedin: `New guide: ${T}.\n\n${r.draft.meta}\n\nFull breakdown + the free checklist: ${url}`,
          facebook: `${T} — new on the blog. We break down the numbers most firms never look at, plus a free 12-point checklist. Read it: ${url}`,
          instagram: `New on the blog: ${T}. The full guide + free checklist — link in bio.\n\n#RDTaxRelief #SafetyEquipmentManufacturing #AdvisoryFirm`
        };
        dist = {
          meta_ads_payload: JSON.stringify(ads),
          ac_email_payload: JSON.stringify(email),
          social_payload: JSON.stringify(social),
          meta_ads_original: JSON.stringify(ads),
          ac_email_original: JSON.stringify(emailOrig),
          social_original: JSON.stringify(social),
          dist_edited: JSON.stringify({ ads: false, email: !!r.distEditedEmail, social: false })
        };
      }
      await pool.query(
        `INSERT INTO content_drafts
          (workflow_run_id, blog_title, blog_meta_description, blog_text, words, magnet_name, lead_magnet_url, live_url, status,
           meta_ads_payload, ac_email_payload, social_payload, meta_ads_original, ac_email_original, social_original, dist_edited,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::draft_status,$10,$11,$12,$13,$14,$15,COALESCE($16::jsonb,'{"ads":false,"email":false,"social":false}'::jsonb),$17,$17)`,
        [
          runId,
          r.draft.title,
          r.draft.meta,
          body,
          r.draft.words,
          r.draft.magnet,
          magnetUrl,
          r.draft.liveUrl ?? null,
          r.draft.status,
          (dist.meta_ads_payload as string) ?? null,
          (dist.ac_email_payload as string) ?? null,
          (dist.social_payload as string) ?? null,
          (dist.meta_ads_original as string) ?? null,
          (dist.ac_email_original as string) ?? null,
          (dist.social_original as string) ?? null,
          (dist.dist_edited as string) ?? null,
          at(r.updatedAgo)
        ]
      );
    }

    for (const [minAgo, who, msg] of r.audits) {
      await pool.query(
        `INSERT INTO audit_trails (workflow_run_id, user_id, actor, action, payload, created_at)
         VALUES ($1,$2,$3,'log',$4,$5)`,
        [runId, who === 'j.mercer' ? mercer : null, who, JSON.stringify({ msg }), at(minAgo)]
      );
    }
  }

  // ---------- registry rows (prototype seedRegistry, verbatim) ----------
  const reg: Array<[number, number, string, string, string, number | null, string, { lev?: number; method?: string }?]> = [
    [118, 1038, 'blog', 'R&D Tax Relief for Safety Equipment Manufacturers: The 2026 Guide', 'a3f10c9e2b74', 0.11, 'unique'],
    [118, 1038, 'magnet', 'R&D Relief Eligibility Checklist — 12-point PDF', '7b21d4a0fe93', 0.09, 'unique'],
    [118, 1038, 'linkedin', 'R&D relief — LinkedIn announcement', 'c5e8817a3d21', 0.18, 'unique'],
    [129, 1038, 'painpoint', 'Safety-equipment makers miss R&D relief on method development', 'e91a2f7c0b56', null, 'unique', { lev: 0.29, method: 'Levenshtein research guard' }],
    [56, 1039, 'blog', 'Pricing Retainers for Fire Risk Assessment Firms: The 2026 Guide', 'd07c3ab19e42', 0.14, 'unique'],
    [58, 1039, 'blog', 'Draft rejected — near-duplicate of WF-1036', 'ff42a8c7101d', 0.88, 'duplicate-blocked'],
    [58, 1039, 'painpoint', 'Fire-risk firms stuck on one-off audits, no recurring revenue', '1c9e40b7a2d8', null, 'unique', { lev: 0.41, method: 'Levenshtein research guard' }],
    [16, 1040, 'blog', 'Financial Planning for Health & Safety Consultancies: The 2026 Guide', 'b83f0d21c7a9', 0.16, 'regenerated'],
    [21, 1040, 'painpoint', 'H&S consultancies run on volatile project income, no retainer base', '3ad9127e0c4f', null, 'unique', { lev: 0.33, method: 'Levenshtein research guard' }],
    [21, 1040, 'painpoint', 'Rejected: too similar to “volatile audit income” pain point', '90f7c1a4e2b3', null, 'duplicate-blocked', { lev: 0.78, method: 'Levenshtein research guard' }]
  ];
  for (const [minAgo, runNo, type, title, h12, sim, status, extra] of reg) {
    await pool.query(
      `INSERT INTO content_registry (workflow_run_id, asset_type, title, body, sha256, tfidf_cosine, levenshtein, status, method, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        runIds[runNo] ?? null,
        type,
        title,
        title, // seed rows: title doubles as the (short) fingerprint corpus
        hash64(h12),
        sim,
        extra?.lev ?? null,
        status,
        extra?.method ?? 'SHA-256 + TF-IDF cosine',
        at(minAgo)
      ]
    );
  }

  // ---------- captured leads (prototype seedLeads, verbatim) ----------
  const leads: Array<[number, string, string, string, string, string, number, boolean]> = [
    [9, 'Priya Nair', 'priya@harborsafetyco.uk', 'R&D Relief Eligibility Checklist', 'Unsure which testing work qualifies for R&D relief', 'meta_ads', 1038, true],
    [42, 'Tom Ellison', 't.ellison@ellisonfire.co.uk', 'Retainer Pricing Worksheet', 'Revenue too lumpy — want recurring retainers', 'organic_social', 1039, true],
    [96, 'Sara Whitfield', 'sara@whitfield-oh.co.uk', 'Financial Health Checklist', 'No cash buffer for quiet compliance months', 'email', 1040, true],
    [3, 'Deepak Rao', 'deepak@raoconsulting.uk', 'R&D Relief Eligibility Checklist', 'Method-development spend not tracked', 'meta_ads', 1038, false]
  ];
  for (const [minAgo, name, email, magnet, pain, source, runNo, synced] of leads) {
    await pool.query(
      `INSERT INTO captured_leads (workflow_run_id, magnet_name, name, email, cf_pain_point, cf_lead_source, synced, created_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [runIds[runNo] ?? null, magnet, name, email, pain, source, synced, at(minAgo), synced ? at(minAgo - 1) : null]
    );
  }

  // New simulated runs number upward from WF-1042 / KB-2215.
  await pool.query(`SELECT setval('wf_run_no_seq', 1042, false)`);
  await pool.query(`SELECT setval('kb_work_no_seq', 2215, false)`);

  console.info('[seed-demo] seeded WF-1038..1041, 10 registry rows, 4 leads, 3 magnet PDFs');
  await pool.end();
}

main().catch((err) => {
  console.error('[seed-demo] failed', err);
  process.exit(1);
});
