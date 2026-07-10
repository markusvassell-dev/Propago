import { GenerationRequest } from '../adapters/types';
import { LeadMagnetContent } from './leadMagnetPdf';

// Deterministic stub content for OPENAI stub mode (placeholder key). Mirrors
// the prototype's mkDraft/fullPost shapes so the dashboard demos identically,
// and is calibrated to clear the real SEO scorer: the primary keyword is
// injected at exactly the occurrence count that lands weighted density in the
// 1.0–1.5% band, appears in the first 100 words + title + meta, the secondary
// keyword heads an H2, sentences stay short, meta is 120–155 chars.

export interface StubDraft {
  blogTitle: string;
  metaDescription: string;
  blogMarkdown: string;
  leadMagnet: LeadMagnetContent;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const nWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const FINANCIAL_HEALTH_ITEMS = [
  'Split revenue by service line — flag anything above 40% concentration',
  'Confirm a three-month fixed-cost cash buffer for quiet months',
  'Review invoices overdue by more than 45 days',
  'Check VAT scheme and flat-rate eligibility before year-end',
  'Set tax aside at the point of invoice, not at year-end'
];

export function stubGenerate(req: GenerationRequest): StubDraft {
  const primary = (req.keywords[0] ?? req.topic).trim();
  const secondary = (req.keywords[1] ?? primary).trim();
  const topic = cap(req.topic);
  const variantAngle =
    req.variant && req.variant.seq > 1
      ? ` This is set ${req.variant.seq} of ${req.variant.of} from one trigger, so it leads with ${req.variant.seq === 2 ? 'pricing mechanics' : 'relief claims'} rather than planning basics.`
      : '';

  const blogTitle = `${topic}: The 2026 Guide`;
  let metaDescription = `${cap(primary)} explained for owner-managers: stabilise cash flow, price retainers and claim overlooked reliefs, with a free 12-point checklist.`;
  if (metaDescription.length > 155) metaDescription = metaDescription.slice(0, 152).replace(/\s+\S*$/, '') + '…';
  if (metaDescription.length < 120) {
    metaDescription = `${metaDescription.replace(/\.$/, '')} — figures, thresholds and deadlines for 2026.`;
  }

  // Base body carries exactly TWO primary-keyword occurrences (intro + one
  // section); the calibrator below adds more only if the density band needs it.
  const para = (...lines: string[]) => lines.join(' ');
  const intro = para(
    `${cap(primary)} decides whether a firm rides out a quiet quarter or borrows through it.`,
    'This guide is written for owner-managers. It covers the figures, thresholds and deadlines that matter in 2026, in plain terms.',
    'Every section ends in something you can price, plan or claim this quarter. Nothing here needs new software or a finance hire.'
  );

  const sections: Array<{ h: string; body: string }> = [
    {
      h: 'Where the money actually leaks:',
      body: para(
        'Start with the concentration problem. Most firms in this position deliver excellent technical work but run on unstable cash.',
        'Map the last twelve months of income by service line and by client. Anything above 40% in a single line is a risk to price against, not a strength.',
        'A quiet month should be a rounding error. When income is concentrated, it becomes a cash event instead.'
      )
    },
    {
      h: `${cap(secondary)}: three bands that work:`,
      body: para(
        'Convert repeatable work into fixed monthly retainers banded by risk and demand cycle, not by headcount or hours.',
        'A three-band structure lets clients self-select and stabilises your baseline.',
        'Set the floor band to cover fixed costs in a quiet month. Add an annual review clause tied to CPI so pricing keeps pace without an awkward renegotiation.'
      )
    },
    {
      h: 'Sizing a cash buffer to demand cycles:',
      body: para(
        'Hold a buffer equal to roughly three months of fixed costs. Size it to your own seasonal cycle, not a generic rule of thumb.',
        'Fund it automatically. Move a fixed share of every invoice into a reserve on receipt, before it ever feels spendable.',
        `Done this way, ${primary} stops being a year-end scramble and becomes a standing habit.`
      )
    },
    {
      h: 'Reliefs most firms leave on the table:',
      body: para(
        'Method development, testing and process improvement often qualify for R&D relief that goes unclaimed because it is filed as routine delivery.',
        'Track the time and cost against the qualifying-activity test as you go, not at year-end.',
        'Pair this with a point-of-invoice tax set-aside so a strong year never turns into a January cash shock.'
      )
    },
    {
      h: 'Your next 90 days:',
      body: para(
        'Pick three moves from the checklist below. Assign an owner and a date. Review them at the end of the quarter.',
        `Small, boring and compounding — that is the whole game.${variantAngle}`,
        'The downloadable checklist that ships with this post turns each move into a concrete step you can tick off with your accountant.'
      )
    }
  ];

  const pads = [
    'One habit worth stealing from larger firms: close the books monthly, even when nothing forces you to. A monthly close takes an hour once the routine exists. It means every decision above rests on numbers that are at most thirty days old. Waiting for year-end is how a small pricing mistake becomes an expensive annual one.',
    'On software: the tool matters far less than the routine. A spreadsheet reviewed every month beats a dashboard nobody opens. Pick the simplest setup that shows income by line, fixed costs and the reserve balance on one page. Resist adding anything you will not act on.',
    'Involve the team. The people delivering the work know which engagements drag, which clients pay late and which services could carry a higher band. A short quarterly conversation about the numbers surfaces more margin than most new sales pushes.',
    'If you inherit messy books, do not try to fix history. Draw a line, set the structure above going forward and let the old ledger stay old. Momentum matters more than a perfect restatement. The checklist is designed to start from wherever you are today.',
    'Deadlines do the heavy lifting. Put the quarterly review, the year-end planning session and the relief-claim cutoff in the calendar now, with an owner against each. What gets scheduled gets done. What stays vague quietly slips a year.',
    'A note on debt: short-term borrowing has a place, but only against a known receivable, never against hope. If the buffer above exists, most of the borrowing that felt necessary last year simply stops happening.',
    'Price rises deserve their own line. Most owner-managed firms under-price by holding rates flat for years, then losing a client over one big correction. Small annual steps, written into the retainer terms, remove the drama entirely.',
    'Watch the debtor days number as closely as the sales number. Work delivered but not collected is a loan you are making at zero interest. A standing weekly chase routine, owned by one named person, typically pulls debtor days down by a third within a quarter.',
    'Separate the owner pay conversation from the profit conversation. Decide a sustainable monthly draw, pay it like any other fixed cost, and let genuine surplus accumulate in the reserve until the quarterly review. Mixing the two is how buffers quietly disappear.',
    'When a big engagement lands, resist the urge to scale fixed costs immediately. Serve it with temporary capacity first, and only convert to permanent overhead once the revenue has repeated for two quarters. Fixed costs added in a good month are the hardest thing to remove in a bad one.',
    'Insurance and professional cover deserve an annual shop-around, not an auto-renewal. Two comparable quotes, requested a month before renewal with your claims history attached, routinely save a four-figure sum for an hour of work.',
    'Build the year-end pack as you go: reliefs log, buffer statement, concentration map, pricing schedule. Arriving at the accountant meeting with those four pages turns it from a compliance cost into a planning session.',
    'None of this requires heroics. It requires a calendar, one owner per number and the discipline to review the same page every month. Firms that do this for four consecutive quarters rarely go back.'
  ];

  let md = `${intro}\n\n`;
  for (const s of sections) md += `## ${s.h}\n\n${s.body}\n\n`;
  md += `### A quick note on ${secondary}:\n\nTreat it as a quarterly habit, not an annual scramble. The firms that win here review the numbers little and often, and they write the results down.\n\n`;
  md += `- Map income concentration by client and service line\n- Price the floor retainer band to cover quiet months\n- Automate the reserve transfer on every invoice\n- Log qualifying R&D activity as it happens\n- Book the quarterly review before the quarter starts\n\n`;

  let pi = 0;
  while (nWords(md) < 1020 && pi < pads.length) md += `${pads[pi++]}\n\n`;
  md += 'Download the checklist below to put this into practice — and if you want a second pair of eyes on the numbers, that is exactly what we do.';

  // ---- density calibration ----
  const kwWords = primary.split(' ').length;
  const occ = (text: string) => text.toLowerCase().split(primary.toLowerCase()).length - 1;
  const density = (text: string) => (occ(text) * kwWords * 100) / nWords(text);
  const fillers = [
    `A disciplined ${primary} review each quarter keeps the plan honest.`,
    `Write the ${primary} numbers down where the whole team can see them.`,
    `If ${primary} feels abstract, start with one figure: fixed costs per quiet month.`,
    `Your accountant should raise ${primary} at every year-end meeting.`,
    `The best ${primary} decisions are the ones you automate.`,
    `Treat ${primary} as a standing agenda item, not a crisis response.`,
    `Good ${primary} is mostly repetition: same figures, same month, every month.`,
    `Put one person in charge of ${primary} and give them a deadline.`,
    `Most ${primary} wins come from pricing, not from cost cutting.`,
    `Review ${primary} before the busy season starts, not after it ends.`,
    `Keep the ${primary} summary to a single page.`,
    `Let the ${primary} checklist drive the agenda of the quarterly meeting.`
  ];
  let f = 0;
  while (density(md) < 1.0 && f < fillers.length) md += `\n\n${fillers[f++]}`;

  const leadMagnet: LeadMagnetContent = {
    name: 'Financial Health Checklist — 12-point PDF',
    subtitle: `The 12 checks behind ${blogTitle.replace(/: The 2026 Guide$/, '')}`,
    sections: [
      { heading: 'Revenue & pricing', items: FINANCIAL_HEALTH_ITEMS.slice(0, 2) },
      { heading: 'Cash & collections', items: FINANCIAL_HEALTH_ITEMS.slice(2, 4) },
      { heading: 'Tax & reliefs', items: FINANCIAL_HEALTH_ITEMS.slice(4) }
    ],
    cta: 'Bring this checklist to your next accountant meeting — or to us, and we will work through it with you.'
  };

  return { blogTitle, metaDescription, blogMarkdown: md, leadMagnet };
}

/**
 * Deterministic platform captions derived from the draft — used both for the
 * generate-stage Uniqueness Registry fingerprints (the 5-asset check) and as
 * the stub distgen payloads, so hashes and published copy stay consistent.
 */
export function stubCaptions(input: { title: string; teaser: string; blogUrl: string; keywords: string[] }): {
  linkedin: string;
  facebook: string;
  instagram: string;
} {
  const T = input.title.replace(/: The 2026 Guide$/, '');
  const tags = input.keywords
    .slice(0, 2)
    .map((k) => '#' + k.replace(/[^a-z0-9 ]/gi, '').split(' ').map(cap).join(''))
    .join(' ');
  return {
    linkedin: `New guide: ${T}.\n\n${input.teaser}\n\nFull breakdown + the free checklist: ${input.blogUrl}`,
    facebook: `${T} — new on the blog. We break down the numbers most firms never look at, plus a free 12-point checklist. Read it: ${input.blogUrl}`,
    instagram: `New on the blog: ${T}. The full guide + free checklist — link in bio.\n\n${tags} #AdvisoryFirm`
  };
}
