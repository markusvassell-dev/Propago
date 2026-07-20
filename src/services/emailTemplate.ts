import { appendUtm } from '../utils/utm';

// Element Accounting branded newsletter template (client-supplied HTML,
// July 2026). Propago's generated copy is slotted into the intro, the post
// panel gets the real blog title/excerpt/URL, and a matching panel carries the
// lead magnet CTA. The sign-off (Daryn Gordon, CPA), P.S. block, social row,
// logo bar and CASL-compliant footer are preserved verbatim from the client's
// design. ActiveCampaign personalisation tags (%FIRSTNAME%, %UNSUBSCRIBELINK%)
// pass through untouched.

export interface BrandedEmailInput {
  subject: string;
  /** Generated email copy (plain text, may contain {{ first_name }} + URLs). */
  body: string;
  campaignSlug: string;
  postTitle: string;
  postExcerpt: string;
  liveUrl: string | null;
  leadMagnetUrl: string | null;
  magnetName: string | null;
}

const FONT = `'Montserrat','Helvetica Neue',Arial,sans-serif`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** MSO-safe rounded CTA button in the client's terracotta (#c87a56). */
function ctaButton(href: string, label: string): string {
  return `
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(href)}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="10%" fillcolor="#c87a56" stroke="f">
      <w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(label)}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <a href="${esc(href)}" target="_blank" rel="noopener" style="display:inline-block;background:#c87a56;color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:14px 34px;border-radius:4px;letter-spacing:0.5px;">${esc(label)} &rarr;</a>
    <!--<![endif]-->`;
}

/** Tinted content panel (post / lead magnet) matching the client's design. */
function panel(eyebrow: string, title: string, copy: string, button: string): string {
  return `
          <tr>
            <td class="px" style="padding:20px 40px 4px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1e0;border:1px solid #d4dbb8;border-radius:6px;">
                <tr>
                  <td align="center" style="background:#dbe1bc;border-radius:6px 6px 0 0;padding:12px 24px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#5d7164;">
                    New from Element Accounting
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 24px 26px 24px;">
                    <p style="margin:0 0 6px 0;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#c87a56;">${esc(eyebrow)}</p>
                    <p style="margin:0 0 10px 0;font-family:${FONT};font-size:20px;line-height:26px;color:#1f241f;font-weight:700;">${esc(title)}</p>
                    <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:23px;color:#2e332e;">${esc(copy)}</p>
                    ${button}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/**
 * Generated body → intro paragraphs. The template supplies its own greeting
 * and both CTAs live in panels, so: swap {{ first_name }} → %FIRSTNAME%,
 * drop a leading greeting line and any paragraph that is just a bare URL.
 */
export function introParagraphs(body: string): string[] {
  const paras = body
    .replace(/\{\{\s*first_name\s*\}\}/g, '%FIRSTNAME%')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras.filter((p, i) => {
    if (i === 0 && /^(hi|hello|hey)\b/i.test(p)) return false; // template greets already
    if (/^https?:\/\/\S+$/.test(p)) return false; // bare link — CTAs carry these
    return true;
  });
}

export function renderBrandedEmail(input: BrandedEmailInput): string {
  const slug = input.campaignSlug;
  const postUrl = appendUtm(input.liveUrl || 'https://elementaccounting.ca/blog/', 'activecampaign', slug);
  const magnetUrl = input.leadMagnetUrl ? appendUtm(input.leadMagnetUrl, 'activecampaign', slug) : null;

  const intro = introParagraphs(input.body)
    .slice(0, 3) // keep the email tight — panels carry the CTAs
    .map((p) => `<p style="margin:0 0 14px 0;">${esc(p).replace(/\n/g, '<br />')}</p>`)
    .join('\n              ');

  const preheader = (input.postExcerpt || `New from the Element blog: ${input.postTitle}`).slice(0, 120);

  const postPanel = panel(
    'Latest post',
    input.postTitle || 'New on the Element blog',
    input.postExcerpt || 'A quick read to help you keep a little more of what you earn.',
    ctaButton(postUrl, 'Read the Post')
  );

  const magnetPanel = magnetUrl
    ? panel(
        'Free download',
        input.magnetName || 'Your free guide',
        'A practical guide that goes deeper than the post — yours free, no strings attached.',
        ctaButton(magnetUrl, 'Get the Free Guide')
      )
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${esc(input.subject)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <!--[if mso]>
  <style>table,td,div,p,a,h1{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
    :root{color-scheme:light only;supported-color-schemes:light only;}
    body{margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
    a{color:#5d7164;}
    .preheader{display:none!important;visibility:hidden;opacity:0;color:#ffffff;height:0;width:0;font-size:1px;line-height:1px;overflow:hidden;}
    @media only screen and (max-width:600px){
      .container{width:100%!important;}
      .px{padding-left:24px!important;padding-right:24px!important;}
      .h1{font-size:27px!important;line-height:33px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">

  <div class="preheader">${esc(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#dbe1bc" style="background:#dbe1bc;">
    <tr>
      <td align="center" style="padding:16px 12px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;">

          <!-- logo bar -->
          <tr>
            <td align="center" style="padding:22px 40px 6px 40px;">
              <a href="https://elementaccounting.ca" target="_blank" rel="noopener" style="text-decoration:none;">
                <img src="https://delightful-cheesecake-215fb8.netlify.app/element-logo.png" alt="Element Accounting" width="190" style="width:190px;height:auto;display:block;margin:0 auto;border:0;outline:none;">
              </a>
            </td>
          </tr>

          <!-- header band -->
          <tr>
            <td style="padding:0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#2c352e;background-image:linear-gradient(150deg,#37413a 0%,#1c231d 100%);border-radius:4px;padding:30px 26px;">
                    <p style="margin:0;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#dbe1bc;">Fresh from the blog</p>
                    <h1 class="h1" style="margin:10px 0 0 0;font-family:${FONT};font-size:30px;line-height:36px;color:#ffffff;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;">Something new<br>to read.</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- intro (generated copy) -->
          <tr>
            <td class="px" style="padding:24px 40px 0 40px;font-family:${FONT};color:#2e332e;font-size:16px;line-height:25px;font-weight:400;">
              <p style="margin:0 0 14px 0;">Hi %FIRSTNAME%,</p>
              ${intro || `<p style="margin:0 0 4px 0;">We just put up a new post. Here's a quick read to help you keep a little more of what you earn.</p>`}
            </td>
          </tr>
${postPanel}
${magnetPanel}

          <!-- sign-off (client's original, verbatim) -->
          <tr>
            <td class="px" style="padding:20px 40px 0 40px;font-family:${FONT};color:#2e332e;font-size:15px;line-height:23px;font-weight:400;">
              <p style="margin:0 0 3px 0;">Talk soon,</p>
              <p style="margin:0 0 16px 0;"><strong style="color:#1f241f;font-weight:700;">Daryn Gordon, CPA</strong><br>Chartered Professional Accountant, 20+ years of experience<br>Element Accounting</p>
              <p style="margin:0 0 22px 0;color:#6e6a60;font-size:14px;line-height:21px;"><strong style="color:#1f241f;font-weight:700;">P.S.</strong> Got a question after reading? Just hit reply. A real person reads every email that comes in.</p>
            </td>
          </tr>

          <!-- social -->
          <tr>
            <td align="center" style="padding:4px 40px 20px 40px;">
              <p style="margin:0 0 10px 0;font-family:${FONT};font-size:15px;color:#1f241f;font-weight:700;">Connect with us</p>
              <a href="https://www.facebook.com/share/18wRenzFJH/" style="text-decoration:none;color:#5d7164;font-family:${FONT};font-size:13px;font-weight:500;padding:0 8px;">Facebook</a>
              <span style="color:#bcb2aa;">|</span>
              <a href="https://ca.linkedin.com/in/daryn-gordon-bbb1b38a" style="text-decoration:none;color:#5d7164;font-family:${FONT};font-size:13px;font-weight:500;padding:0 8px;">LinkedIn</a>
              <span style="color:#bcb2aa;">|</span>
              <a href="mailto:info@elementaccounting.ca" style="text-decoration:none;color:#5d7164;font-family:${FONT};font-size:13px;font-weight:500;padding:0 8px;">Email</a>
              <span style="color:#bcb2aa;">|</span>
              <a href="tel:+14032824647" style="text-decoration:none;color:#5d7164;font-family:${FONT};font-size:13px;font-weight:500;padding:0 8px;">Call us</a>
            </td>
          </tr>

          <!-- footer (CASL / CAN-SPAM compliant) -->
          <tr>
            <td style="background:#2c352e;padding:20px 40px;border-radius:0 0 6px 6px;">
              <p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#bcb2aa;text-align:center;font-weight:400;">
                You're receiving this because you signed up at elementaccounting.ca.
              </p>
              <p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#bcb2aa;text-align:center;font-weight:400;">
                Element Accounting &bull; 2750 3 Ave NE, Calgary, AB T2A 2L5, Canada
              </p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:#bcb2aa;text-align:center;font-weight:400;">
                <a href="%UNSUBSCRIBELINK%" style="color:#dbe1bc;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
