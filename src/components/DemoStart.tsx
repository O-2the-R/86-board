// The public demo's front door. Pick a role, get a made-up login for it from
// the same generator managers use, and explore the three sample restaurants.
// Everything here talks to the sample data drawer directly, never to AWS.
import { useState } from 'react';
import { addDemoGuest, mockApi } from '../api/mock';
import { DEMO_ROLES, demoUsername, type DemoRoleInfo } from '../lib/demo';
import { randomInt } from '../lib/random';
import { passwordFrom } from '../../shared/logins';
import { RESTAURANTS } from '../../shared/sample-data';
import { CopyLine } from './CopyLine';

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
  const [error, setError] = useState<string | null>(null);

  function pick(info: DemoRoleInfo) {
    setError(null);
    setLogin({ info, username: demoUsername(info.role, randomInt), password: passwordFrom(randomInt) });
  }

  async function start() {
    if (!login) return;
    setBusy(true);
    setError(null);
    try {
      addDemoGuest({ username: login.username, displayName: 'Guest', role: login.info.role, restaurantId: login.info.restaurantId }, login.password);
      await mockApi.signIn(login.username, login.password);
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The demo did not start. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="demo">
      {!login ? (
        <>
          <p className="demo-ask">Who do you want to be?</p>
          <div className="demo-roles">
            {DEMO_ROLES.map((r) => (
              <button key={r.role} type="button" className="demo-role" onClick={() => pick(r)}>
                <span className="demo-role-name">{r.label}</span>
                <span className="demo-role-line">{r.line}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="notice demo-login" role="status">
          <span className="demo-login-title">Your demo login</span>
          <CopyLine label="Username" value={login.username} big />
          <CopyLine label="Password" value={login.password} big />
          <span className="caption">
            {login.info.label} at {placeOf(login.info)}. Made just now, for this phone only.
          </span>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-wide btn-paper" disabled={busy} onClick={start}>
            {busy ? 'One moment…' : 'Start the demo'}
          </button>
          <button type="button" className="btn btn-sm btn-text" onClick={() => setLogin(null)}>
            Pick a different role
          </button>
        </div>
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
