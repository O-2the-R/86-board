// The public demo's front door. Pick a role and the demo makes a login for it
// from the same generator managers use. The login exists the moment it shows,
// and the sign-in form comes already filled in, so there is nothing to copy:
// one tap on Sign In and the visitor is on the board. Each line has its own
// Copy button for later. Everything here talks to the sample data drawer
// directly, never to AWS.
import { useState, type FormEvent } from 'react';
import { addDemoGuest, mockApi } from '../api/mock';
import { DEMO_ROLES, demoUsername, type DemoRoleInfo } from '../lib/demo';
import { randomInt } from '../lib/random';
import { passwordFrom } from '../../shared/logins';
import { RESTAURANTS } from '../../shared/sample-data';

interface DemoLogin {
  info: DemoRoleInfo;
  username: string;
  password: string;
}

const placeOf = (info: DemoRoleInfo) =>
  info.restaurantId === 'all' ? 'all three restaurants' : (RESTAURANTS.find((r) => r.id === info.restaurantId)?.name ?? info.restaurantId);

export function DemoStart({ onSignedIn, onSignInInstead }: { onSignedIn: () => void; onSignInInstead: () => void }) {
  const [login, setLogin] = useState<DemoLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'user' | 'pass' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Make the login and register it right away, so it also works typed into
  // either sign-in box on this phone.
  function make(info: DemoRoleInfo) {
    const username = demoUsername(info.role, randomInt);
    const password = passwordFrom(randomInt);
    addDemoGuest({ username, displayName: 'Guest', role: info.role, restaurantId: info.restaurantId }, password);
    setLogin({ info, username, password });
    setError(null);
    setCopied(null);
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!login) return;
    setBusy(true);
    setError(null);
    try {
      await mockApi.signIn(login.username, login.password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The demo did not start. Try again.');
      setBusy(false);
    }
  }

  // One line at a time, so it pastes straight into a sign-in box.
  async function copy(which: 'user' | 'pass') {
    if (!login) return;
    try {
      await navigator.clipboard.writeText(which === 'user' ? login.username : login.password);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // the field is selectable; the person can copy by hand
    }
  }

  return (
    <div className="demo">
      {!login ? (
        <>
          <p className="demo-ask">Who do you want to be?</p>
          <div className="demo-roles">
            {DEMO_ROLES.map((r) => (
              <button key={r.role} type="button" className="demo-role" onClick={() => make(r)}>
                <span className="demo-role-name">{r.label}</span>
                <span className="demo-role-line">{r.line}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form className="login-form demo-login" onSubmit={signIn}>
          <div className="demo-login-head">
            <span className="demo-login-title">Your demo login</span>
            <span className="caption">
              {login.info.label} at {placeOf(login.info)}
            </span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="demo-user">
              Username
            </label>
            <div className="input-with-btn">
              <input id="demo-user" className="input input-mono" type="text" value={login.username} readOnly autoComplete="off" spellCheck={false} />
              <button type="button" className="btn btn-sm btn-outline" onClick={() => copy('user')} aria-label="Copy username">
                {copied === 'user' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="demo-pass">
              Password
            </label>
            <div className="input-with-btn">
              <input id="demo-pass" className="input input-mono" type="text" value={login.password} readOnly autoComplete="off" spellCheck={false} />
              <button type="button" className="btn btn-sm btn-outline" onClick={() => copy('pass')} aria-label="Copy password">
                {copied === 'pass' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <span className="hint">Already filled in. Made just now, for this phone only, by the same generator managers use.</span>
          {error && (
            <p className="error center" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-wide" disabled={busy}>
            {busy ? 'One moment…' : 'Sign In'}
          </button>
          <div className="demo-login-actions">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => make(login.info)}>
              New login
            </button>
            <button type="button" className="btn btn-sm btn-text" onClick={() => setLogin(null)}>
              Different role
            </button>
          </div>
        </form>
      )}

      <p className="preview-note">
        A demo with sample restaurants. Everything you do stays on this phone. Nothing reaches a real kitchen, and no alerts are sent.
      </p>
      <button type="button" className="link-btn demo-alt" onClick={onSignInInstead}>
        Already have a demo login? Sign in
      </button>
    </div>
  );
}
