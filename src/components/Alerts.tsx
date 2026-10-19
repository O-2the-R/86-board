// Phone alerts: the bell in the top bar, the nudge on the board, and the
// sheet that turns alerts on or off and explains what to do on an iPhone.
import { useCallback, useEffect, useState } from 'react';
import { readString, writeString } from '../lib/storage';
import { alertState, canPromptInstall, isStandalone, promptInstall, rebind, turnOff, turnOn, type AlertState } from '../push';

const NUDGE_KEY = 'eightysix.alerts.nudge';

export function useAlerts(username: string) {
  const [state, setState] = useState<AlertState>('off');
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setState(await alertState());
  }, []);

  useEffect(() => {
    void rebind().then(refresh);
  }, [username, refresh]);

  return { state, setState, open, setOpen, refresh };
}

export function AlertsBell({ state, onClick }: { state: AlertState; onClick: () => void }) {
  const on = state === 'on';
  return (
    <button type="button" className={'icon-btn' + (on ? ' is-on' : '')} onClick={onClick} aria-label={on ? 'Alerts are on' : 'Alerts'}>
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      {on && <span className="icon-dot" aria-hidden="true" />}
    </button>
  );
}

// Shown once on the board until the person turns alerts on or waves it away.
export function AlertsNudge({ state, onOpen }: { state: AlertState; onOpen: () => void }) {
  const [hidden, setHidden] = useState(() => readString(NUDGE_KEY) === 'done');
  if (hidden || state === 'on' || state === 'blocked' || state === 'unsupported') return null;
  function dismiss() {
    writeString(NUDGE_KEY, 'done');
    setHidden(true);
  }
  return (
    <div className="nudge" role="note">
      <div className="nudge-text">
        <b>Get a buzz on this phone</b>
        <span>When something is 86'd, runs low, or comes back on. Even with the app closed.</span>
      </div>
      <div className="nudge-actions">
        <button type="button" className="btn btn-sm" onClick={onOpen}>
          {state === 'needs-install' ? 'How' : 'Turn on'}
        </button>
        <button type="button" className="btn btn-sm btn-text" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface SheetProps {
  state: AlertState;
  restaurantName?: string;
  onChange: (s: AlertState) => void;
  onClose: () => void;
}

export function AlertsSheet({ state, restaurantName, onChange, onClose }: SheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(work: () => Promise<AlertState>) {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      onChange(next);
      if (next === 'on') writeString(NUDGE_KEY, 'done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const where = restaurantName ? `at ${restaurantName}` : 'at your restaurant';
  const showInstall = !isStandalone() && canPromptInstall();

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="alerts-heading" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <h2 id="alerts-heading" className="sheet-title">
          Phone alerts
        </h2>

        {state === 'on' && (
          <>
            <p className="sheet-text">Alerts are on for this phone. You get a buzz when something {where} is 86'd, runs low, or comes back on.</p>
            <button type="button" className="btn btn-wide btn-outline" disabled={busy} onClick={() => run(turnOff)}>
              Turn off alerts on this phone
            </button>
          </>
        )}

        {state === 'off' && (
          <>
            <p className="sheet-text">Your phone will buzz when something {where} is 86'd, runs low, or comes back on. It works with the app closed.</p>
            <button type="button" className="btn btn-wide" disabled={busy} onClick={() => run(turnOn)}>
              {busy ? 'One moment…' : 'Turn on alerts'}
            </button>
            {showInstall && (
              <button type="button" className="btn btn-wide btn-outline" disabled={busy} onClick={() => void promptInstall()}>
                Add 86 Board to the home screen
              </button>
            )}
          </>
        )}

        {state === 'needs-install' && (
          <>
            <p className="sheet-text">On an iPhone, alerts only work once 86 Board is on your Home Screen. Two taps:</p>
            <ol className="steps">
              <li>
                Tap the Share button in Safari <span className="kbd">⎙</span>
              </li>
              <li>
                Tap <b>Add to Home Screen</b>, then <b>Add</b>
              </li>
              <li>Open 86 Board from the Home Screen and come back here to turn alerts on</li>
            </ol>
          </>
        )}

        {state === 'blocked' && (
          <p className="sheet-text">
            Notifications for 86 Board are blocked in this phone's settings. Allow them under Settings, Notifications, 86 Board, then come back here.
          </p>
        )}

        {state === 'unsupported' && (
          <p className="sheet-text">This browser cannot show alerts. On an iPhone use Safari, on Android use Chrome.</p>
        )}

        {state === 'preview' && (
          <p className="sheet-text">This is the preview with sample data, so there is no server to send alerts. On the real site this is where you turn them on.</p>
        )}

        {error && (
          <p className="error center" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="btn btn-text btn-wide" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
