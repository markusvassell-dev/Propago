import { ReactNode } from 'react';

// Rendered previews of what each channel will actually publish, shown at the
// distribution review gate. Reviewers were previously approving raw payload
// text and having to imagine the result; these mirror each platform's real
// layout closely enough to catch awkward truncation, a weak hook or a missing
// link before anything goes live.
//
// Purely presentational — every value comes from the run's payloads.

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function Shell({ tint, name, children }: { tint: string; name: string; children: ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 9, overflow: 'hidden', border: '1px solid var(--line4)', fontFamily: FONT, color: '#1c1e21' }}>
      <div style={{ background: tint, color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center', padding: '6px 8px' }}>
        {name}
      </div>
      {children}
    </div>
  );
}

function Head({ sub, round = true }: { sub: string; round?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px 6px' }}>
      <span style={{ width: 34, height: 34, borderRadius: round ? '50%' : 7, background: '#2c352e', color: '#dbe1bc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
        E
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>Element Accounting</div>
        <div style={{ fontSize: 10.5, color: '#65676b' }}>{sub}</div>
      </div>
    </div>
  );
}

/** Dark-green article card used where a platform renders a link preview. */
function LinkCard({ title, url }: { title: string; url: string }) {
  const domain = (url || 'elementaccounting.ca').replace(/^https?:\/\//, '').split('/')[0];
  return (
    <div style={{ borderTop: '1px solid #e4e6eb', borderBottom: '1px solid #e4e6eb', background: '#f0f2f5' }}>
      <div style={{ background: 'linear-gradient(150deg,#37413a 0%,#1c231d 100%)', minHeight: 108, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#dbe1bc' }}>Element Accounting · Blog</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, lineHeight: 1.25 }}>{title || 'Your post title'}</div>
      </div>
      <div style={{ padding: '8px 11px' }}>
        <div style={{ fontSize: 10, color: '#65676b', textTransform: 'uppercase' }}>{domain}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 1 }}>{title || 'Your post title'}</div>
      </div>
    </div>
  );
}

const Body = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: '2px 11px 10px', fontSize: 12.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{children}</div>
);

const Acts = ({ items }: { items: string[] }) => (
  <div style={{ display: 'flex', justifyContent: 'space-around', padding: '5px 6px', borderTop: '1px solid #e4e6eb', color: '#65676b', fontSize: 11.5, fontWeight: 600 }}>
    {items.map((a) => <span key={a} style={{ padding: 4 }}>{a}</span>)}
  </div>
);

export function FacebookPreview({ caption, title, url }: { caption: string; title: string; url: string }) {
  return (
    <Shell tint="#1877f2" name="Facebook Page">
      <Head sub="Just now · 🌐" />
      <Body>{caption || <em style={{ color: '#8a8d91' }}>No caption generated</em>}</Body>
      <LinkCard title={title} url={url} />
      <Acts items={['👍 Like', '💬 Comment', '↗ Share']} />
    </Shell>
  );
}

export function LinkedInPreview({ caption, title, url }: { caption: string; title: string; url: string }) {
  return (
    <Shell tint="#0a66c2" name="LinkedIn">
      <Head sub="Just now · 🌐" round={false} />
      <Body>{caption || <em style={{ color: '#8a8d91' }}>No caption generated</em>}</Body>
      <LinkCard title={title} url={url} />
      <Acts items={['👍 Like', '💬 Comment', '🔁 Repost', '📤 Send']} />
    </Shell>
  );
}

export function InstagramPreview({ caption, title }: { caption: string; title: string }) {
  const hasLink = /https?:\/\//.test(caption);
  return (
    <Shell tint="#dd2a7b" name="Instagram">
      <Head sub="Calgary, Alberta" />
      <div style={{ aspectRatio: '1', background: 'linear-gradient(150deg,#37413a 0%,#1c231d 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '0 26px', textAlign: 'center' }}>
        <div style={{ color: '#dbe1bc', fontWeight: 800, letterSpacing: 2.5, fontSize: 9.5, textTransform: 'uppercase' }}>Element Accounting</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, lineHeight: 1.3 }}>{title || 'Your post title'}</div>
        <div style={{ marginTop: 2, background: '#c87a56', color: '#fff', fontSize: 9.5, fontWeight: 700, padding: '5px 12px', borderRadius: 3, letterSpacing: 1, textTransform: 'uppercase' }}>New on the blog</div>
      </div>
      <div style={{ display: 'flex', gap: 12, padding: '8px 11px 2px', fontSize: 17 }}>
        <span>♥</span><span>💬</span><span>📤</span><span style={{ marginLeft: 'auto' }}>🔖</span>
      </div>
      <Body>{caption || <em style={{ color: '#8a8d91' }}>No caption generated</em>}</Body>
      {hasLink && (
        <div style={{ background: 'rgba(180,83,9,.1)', color: '#8a4b2a', fontSize: 10.5, padding: '6px 11px', lineHeight: 1.5 }}>
          ⚠ Instagram captions can’t contain clickable links — use “link in bio”.
        </div>
      )}
    </Shell>
  );
}

export function MetaAdPreview({ headline, primaryText, url }: { headline: string; primaryText: string; url: string }) {
  const domain = (url || 'elementaccounting.ca').replace(/^https?:\/\//, '').split('/')[0];
  return (
    <Shell tint="#2547a8" name="Meta lead ad (created paused)">
      <Head sub="Sponsored · 🌐" />
      <Body>{primaryText || <em style={{ color: '#8a8d91' }}>No primary text</em>}</Body>
      <div style={{ background: 'linear-gradient(150deg,#37413a 0%,#1c231d 100%)', aspectRatio: '1.91/1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2.2, textTransform: 'uppercase', color: '#dbe1bc' }}>Free download</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>{headline || 'Your ad headline'}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0f2f5', padding: '9px 11px', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#65676b', textTransform: 'uppercase' }}>{domain}</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headline || 'Your ad headline'}</div>
        </div>
        <span style={{ background: '#e4e6eb', fontSize: 12, fontWeight: 600, borderRadius: 5, padding: '6px 11px', whiteSpace: 'nowrap' }}>Download</span>
      </div>
      <div style={{ fontSize: 10, color: '#65676b', padding: '7px 11px', lineHeight: 1.5 }}>
        Created <strong>PAUSED</strong> — activate in Ads Manager to spend.
      </div>
    </Shell>
  );
}

export function EmailPreview({ subject, body, title }: { subject: string; body: string; title: string }) {
  const paras = (body || '')
    .replace(/\{\{\s*first_name\s*\}\}/g, '%FIRSTNAME%')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p, i) => !(i === 0 && /^(hi|hello|hey)\b/i.test(p)))
    .filter((p) => !/^https?:\/\/\S+$/.test(p))
    .slice(0, 3);

  return (
    <Shell tint="#265b8f" name="Email (ActiveCampaign)">
      <div style={{ background: '#f0f2f5', padding: '7px 11px', fontSize: 11, borderBottom: '1px solid #e4e6eb' }}>
        <span style={{ color: '#65676b' }}>Subject: </span>
        <strong>{subject || <em style={{ color: '#8a8d91' }}>No subject</em>}</strong>
      </div>
      <div style={{ background: '#dbe1bc', padding: 10 }}>
        <div style={{ background: '#fff', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ textAlign: 'center', padding: '13px 14px 4px', fontWeight: 800, letterSpacing: 1, color: '#2c352e', fontSize: 12 }}>ELEMENT ACCOUNTING</div>
          <div style={{ margin: '0 14px', background: 'linear-gradient(150deg,#37413a 0%,#1c231d 100%)', borderRadius: 4, padding: '16px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 2.4, textTransform: 'uppercase', color: '#dbe1bc' }}>Fresh from the blog</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, textTransform: 'uppercase', marginTop: 5, lineHeight: 1.2 }}>Something new<br />to read.</div>
          </div>
          <div style={{ padding: '11px 14px 4px', fontSize: 11.5, lineHeight: 1.55, color: '#2e332e' }}>
            <p style={{ margin: '0 0 8px' }}>Hi %FIRSTNAME%,</p>
            {paras.length ? paras.map((p, i) => <p key={i} style={{ margin: '0 0 8px' }}>{p}</p>) : <p style={{ margin: 0, color: '#8a8d91' }}><em>No body copy generated</em></p>}
          </div>
          <div style={{ margin: '4px 14px 12px', background: '#eef1e0', border: '1px solid #d4dbb8', borderRadius: 5, padding: '11px 12px' }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: '#c87a56' }}>Latest post</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1f241f', margin: '4px 0 8px', lineHeight: 1.3 }}>{title || 'Your post title'}</div>
            <span style={{ display: 'inline-block', background: '#c87a56', color: '#fff', fontSize: 11, fontWeight: 700, padding: '7px 15px', borderRadius: 3 }}>Read the Post →</span>
          </div>
          <div style={{ padding: '0 14px 12px', fontSize: 11, color: '#2e332e', lineHeight: 1.5 }}>
            Talk soon,<br /><strong>Daryn Gordon, CPA</strong>
          </div>
          <div style={{ background: '#2c352e', color: '#bcb2aa', fontSize: 9, textAlign: 'center', padding: '9px 14px', lineHeight: 1.5 }}>
            Element Accounting · Calgary, AB · <span style={{ color: '#dbe1bc', textDecoration: 'underline' }}>Unsubscribe</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
