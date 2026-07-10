// The inline lead-magnet PDF mock (spec §7.3 / §8.5 / §9.2). Checklist items
// pick by magnet-name match — the prototype's magnetItems() lists, verbatim.

const LISTS: Record<string, string[]> = {
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

export function magnetItems(magnetName: string): Array<{ n: string; t: string }> {
  const key = Object.keys(LISTS).find((k) => magnetName.indexOf(k) >= 0);
  const arr = LISTS[key ?? 'Financial Health'] ?? LISTS['Financial Health'];
  return arr.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), t }));
}

export default function PdfSheet({
  magnetName,
  footer = '+ 7 more items · page 1 of 3',
  maxWidth = 500
}: {
  magnetName: string;
  footer?: string;
  maxWidth?: number;
}) {
  const items = magnetItems(magnetName);
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid var(--line5)',
        borderRadius: 6,
        maxWidth,
        margin: '0 auto',
        padding: '26px 30px',
        boxShadow: '0 6px 18px rgba(20,18,12,.08)'
      }}
    >
      <div className="mono" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.14em', color: '#8a8578' }}>
        Element Accounting · client resource
      </div>
      <div className="disp" style={{ fontSize: 20, fontWeight: 700, color: '#1a1d20', marginTop: 8, lineHeight: 1.3 }}>
        {magnetName}
      </div>
      <div style={{ marginTop: 14 }}>
        {items.map((it) => (
          <div
            key={it.n}
            style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px dashed #e4e1d7', alignItems: 'baseline' }}
          >
            <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: '#137a5b' }}>{it.n}</span>
            <span style={{ fontSize: 12, color: '#3a3e44', lineHeight: 1.55 }}>{it.t}</span>
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: '#bdb8a9', marginTop: 12 }}>{footer}</div>
    </div>
  );
}
