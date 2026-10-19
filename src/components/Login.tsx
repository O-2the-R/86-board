// The front door. Username and password; a first sign-in on a temporary
// password asks for a new one before letting the person in.
import { useState, type FormEvent } from 'react';
import type { Restaurant } from '../types';
import { api } from '../api';

interface Props {
  restaurants: Restaurant[];
  onSignedIn: () => void;
}

export function Login({ restaurants, onSignedIn }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<'signIn' | 'newPassword'>('signIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'signIn') {
        const res = await api.signIn(username, password);
        if (res.status === 'newPassword') setStep('newPassword');
        else onSignedIn();
      } else {
        await api.completeNewPassword(newPassword);
        onSignedIn();
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-mark">
        <div className="app-icon" aria-hidden="true">
          86
        </div>
        <h1 className="login-title">86 Board</h1>
        <p className="login-sub">Whitfield Hospitality</p>
      </div>

      <form className="login-form" onSubmit={submit}>
        {step === 'signIn' ? (
          <>
            <div className="field">
              <label className="field-label" htmlFor="login-user">
                Username
              </label>
              <input
                id="login-user"
                className="input"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="first.last"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="login-pass">
                Password
              </label>
              <input
                id="login-pass"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </>
        ) : (
          <>
            <p className="center">Welcome, {username.trim().toLowerCase()}. Choose a password of your own to finish signing in.</p>
            <div className="field">
              <label className="field-label" htmlFor="login-new">
                New password
              </label>
              <input
                id="login-new"
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
              <span className="hint">At least 8 characters, with a capital letter, a number and a symbol.</span>
            </div>
          </>
        )}

        {error && (
          <p className="error center" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-wide" disabled={busy}>
          {busy ? 'One moment…' : step === 'signIn' ? 'Sign In' : 'Save and Sign In'}
        </button>

        {step === 'signIn' &&
          (api.mode === 'sample' ? (
            <p className="preview-note">Preview with sample data. Sign in as omar, priya.m, marco.r, sam.t or lena.k, any password.</p>
          ) : (
            <p className="preview-note">Forgot your password? A manager can reset it.</p>
          ))}
      </form>

      <div className="login-foot" aria-hidden="true">
        <span style={{ textWrap: 'balance' }}>{restaurants.map((r) => r.name).join('  ·  ')}</span>
      </div>
    </div>
  );
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Incorrect username or password|NotAuthorized/i.test(msg)) return 'That username and password do not match.';
  if (/User does not exist|UserNotFound/i.test(msg)) return 'No account with that username.';
  if (/disabled/i.test(msg)) return 'This account has been switched off. Ask a manager.';
  if (/Password did not conform|policy/i.test(msg)) return 'That password is too simple. Use at least 8 characters with a capital letter, a number and a symbol.';
  if (/attempts exceeded/i.test(msg)) return 'Too many tries. Wait a few minutes and try again.';
  return msg;
}
