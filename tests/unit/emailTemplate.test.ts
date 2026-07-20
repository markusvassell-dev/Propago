import { describe, it, expect } from 'vitest';
import { renderBrandedEmail, introParagraphs } from '../../src/services/emailTemplate';

const base = {
  subject: 'Cash flow tips for clinic owners',
  body: 'Hi {{ first_name }},\n\nWe wrote something for you about cash flow forecasting.\n\nhttps://elementaccounting.ca/blog/cash-flow',
  campaignSlug: 'cash-flow-forecasting',
  postTitle: 'Cash flow forecasting for clinics',
  postExcerpt: 'A practical look at forward cash planning.',
  liveUrl: 'https://elementaccounting.ca/blog/cash-flow',
  leadMagnetUrl: 'https://elementaccounting.ca/magnets/cash-flow-guide.pdf',
  magnetName: 'The Clinic Cash Flow Guide'
};

describe('introParagraphs — generated copy → template intro', () => {
  it('drops the greeting (template greets), bare-URL paragraphs, and converts first_name tags', () => {
    const paras = introParagraphs(base.body);
    expect(paras).toHaveLength(1);
    expect(paras[0]).toContain('cash flow forecasting');
    expect(paras.join(' ')).not.toMatch(/^Hi/);
    expect(paras.join(' ')).not.toContain('https://');
  });

  it('keeps AC personalisation tags in %FIRSTNAME% form', () => {
    expect(introParagraphs('Thanks {{first_name}}, more below.')[0]).toContain('%FIRSTNAME%');
  });
});

describe('renderBrandedEmail — Element Accounting newsletter', () => {
  const html = renderBrandedEmail(base);

  it('preserves the client sign-off, P.S., social row, and CASL footer verbatim', () => {
    expect(html).toContain('Talk soon,');
    expect(html).toContain('Daryn Gordon, CPA');
    expect(html).toContain('Chartered Professional Accountant, 20+ years of experience');
    expect(html).toContain('A real person reads every email');
    expect(html).toContain('Connect with us');
    expect(html).toContain('2750 3 Ave NE, Calgary');
    expect(html).toContain('%UNSUBSCRIBELINK%');
    expect(html).toContain('%FIRSTNAME%');
    expect(html).toContain('element-logo.png');
  });

  it('slots the real post + lead magnet with UTM-tagged CTAs', () => {
    expect(html).toContain('Cash flow forecasting for clinics');
    expect(html).toContain('The Clinic Cash Flow Guide');
    expect(html).toContain('utm_source=activecampaign');
    expect(html).toContain('utm_campaign=cash-flow-forecasting');
    expect(html).toContain('Read the Post');
    expect(html).toContain('Get the Free Guide');
  });

  it('omits the magnet panel when there is no magnet URL', () => {
    const noMagnet = renderBrandedEmail({ ...base, leadMagnetUrl: null });
    expect(noMagnet).not.toContain('Get the Free Guide');
    expect(noMagnet).toContain('Read the Post'); // post panel remains
  });

  it('escapes HTML in generated fields', () => {
    const xss = renderBrandedEmail({ ...base, postTitle: 'Tips <script>alert(1)</script>' });
    expect(xss).not.toContain('<script>alert(1)</script>');
    expect(xss).toContain('&lt;script&gt;');
  });
});
