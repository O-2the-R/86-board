// The public demo's front door. Pick a role and the demo makes a login for it
// from the same generator managers use. The login exists the moment it shows,
// and the sign-in form comes already filled in, so there is nothing to copy:
// one tap on Sign In and the visitor is on the board. Everything here talks
// to the sample data drawer directly, never to AWS.
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

// Both lines in one copy, so a phone's single clipboard is enough.
export const demoLoginText = (username: string, password: string) => `Username: ${username}\nPassword: ${password}`;

export function DemoStart({ onSignedIn, onSignInInstead }: { onSignedIn: () => void; onSignInInstead: () => void }) {
  const [login, setLogin] = useState<DemoLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Make the login and register it right away, so it also works typed into
  // either sign-in box on this phone.
  function make(info: DemoRoleInfo) {
    const username = demoUsername(info.role, randomInt);
    const password = passwordFrom(randomInt);
    addDemoGuest({ username, displayName: 'Guest', role: info.role, restaurantId: info.restaurantId }, password);
    setLogin({ info, username, password });
    setError(null);
    setCopied(false);
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

  async function copy() {
    if (!login) return;
    try {
      await navigator.clipboard.writeText(demoLoginText(login.username, login.password));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the fields are selectable; the person can copy by hand
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
            <input id="demo-user" className="input input-mono" type="text" value={login.username} readOnly autoComplete="off" spellCheck={false} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="demo-pass">
              Password
            </label>
            <input id="demo-pass" className="input input-mono" type="text" value={login.password} readOnly autoComplete="off" spellCheck={false} />
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
            <button type="button" className="btn btn-sm btn-outline" onClick={copy}>
              {copied ? 'Copied both lines' : 'Copy login'}
            </button>
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
