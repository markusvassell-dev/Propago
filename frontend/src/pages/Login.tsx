import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';

// Login screen (DESIGN_SPEC §4) — full-viewport overlay, invite-only copy,
// demo-account rows that pre-fill the form (seed password: change-me).

const DEMO = [
  { initials: 'JM', name: 'Jude Mercer', email: 'jmercer@elementaccounting.ca', role: 'admin', c: 'var(--grn)' },
  { initials: 'DO', name: 'Dana Okafor', email: 'dokafor@elementaccounting.ca', role: 'reviewer', c: 'var(--vio)' },
  { initials: 'MR', name: 'Marcus Reyes', email: 'mreyes@elementaccounting.ca', role: 'editor', c: 'var(--amb)' }
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      nav('/runs');
    } catch (err) {
      if (err instanceof ApiError && err.message) setError(err.message);
      else setError('Sign-in failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: 400 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div
            className="disp"
            style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--grn)', color: '#F4F2ED', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            N
          </div>
          <div>
            <div className="disp" style={{ fontWeight: 700, fontSize: 19 }}>Propago</div>
            <div className="mono" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--tx3)' }}>
              marketing ops · team sign-in
            </div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="card"
          style={{ marginTop: 18, padding: 22, boxShadow: '0 10px 30px rgba(20,18,12,.08)' }}
        >
          <label className="microlabel">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@elementaccounting.ca"
            className="nf-input"
            style={{ marginTop: 5 }}
          />
          <label className="microlabel" style={{ display: 'block', marginTop: 13 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="nf-input"
            style={{ marginTop: 5 }}
          />
          {error && <p style={{ marginTop: 10, marginBottom: 0, fontSize: 11.5, color: 'var(--red)', lineHeight: 1.5 }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 10px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line2)' }} />
            <span className="mono" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--tx3)' }}>
              demo accounts
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--line2)' }} />
          </div>

          {DEMO.map((u) => (
            <button
              key={u.email}
              type="button"
              className="rowhover"
              onClick={() => {
                setEmail(u.email);
                setPassword('change-me');
                setError('');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px', borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
            >
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--vio)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>
                {u.initials}
              </span>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--tx)' }}>{u.name}</span>
              <span className="mono" style={{ fontSize: 10.5, color: u.c }}>{u.role}</span>
            </button>
          ))}
        </form>

        <p style={{ fontSize: 10, color: 'var(--tx4)', lineHeight: 1.6, marginTop: 12, textAlign: 'center' }}>
          Invite-only — only accounts an admin has added can sign in; there is no open sign-up. Pick a demo account (seed password: change-me — rotate immediately).
        </p>
      </div>
    </div>
  );
}
