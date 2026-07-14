import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

// Set-password screen (invited users + resets). Reached via the single-use
// link /set-password?token=… . Posts to /api/auth/set-password, then sends the
// user to /login to sign in with their new password.

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('This link is missing its token. Ask an admin for a new set-password link.');
      return;
    }
    if (pw !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/set-password', { token, password: pw });
      setDone(true);
      setTimeout(() => nav('/login'), 1400);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : 'Could not set your password — try again.');
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
              marketing ops · set your password
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="card" style={{ marginTop: 18, padding: 22, boxShadow: '0 10px 30px rgba(20,18,12,.08)' }}>
          {done ? (
            <p style={{ fontSize: 13, color: 'var(--grn)', margin: 0, lineHeight: 1.6 }}>
              Password set. Taking you to sign in…
            </p>
          ) : (
            <>
              <label className="microlabel">New password</label>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="At least 8 chars, incl. a letter and a number"
                className="nf-input"
                style={{ marginTop: 5 }}
              />
              <label className="microlabel" style={{ display: 'block', marginTop: 13 }}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                className="nf-input"
                style={{ marginTop: 5 }}
              />
              {error && <p style={{ marginTop: 10, marginBottom: 0, fontSize: 11.5, color: 'var(--red)', lineHeight: 1.5 }}>{error}</p>}
              <button type="submit" disabled={busy} className="btn btn-primary" style={{ width: '100%', marginTop: 16 }}>
                {busy ? 'Setting…' : 'Set password'}
              </button>
            </>
          )}
        </form>

        <p style={{ fontSize: 10, color: 'var(--tx4)', lineHeight: 1.6, marginTop: 12, textAlign: 'center' }}>
          This is a one-time link. After setting your password, sign in with your email and new password.
        </p>
      </div>
    </div>
  );
}
