// Who has a login, and the switch to cut someone off. Owners see every
// restaurant; managers see their own. Nobody is ever deleted: the history
// keeps their name. (Remove exists only for a login that was never used.)
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Restaurant, Session, Staff as Person, StaffRole } from '../types';
import { ROLE_LABEL, STAFF_ROLES, isOwner } from '../types';
import { api } from '../api';
import type { ManageAction } from '../api/types';
import { initials } from '../lib/format';
import { CopyLine, CopyMessage } from './CopyLine';
import { Automations } from './Automations';
import { cleanUsername, loginMessage, passwordFrom, usernameFor } from '../../shared/logins';
import { randomInt } from '../lib/random';
import { inDemo } from '../lib/demo';

interface Props {
  session: Session;
  restaurants: Restaurant[];
  onDataChanged: () => void; // after demo data loads
}

interface Notice {
  title: string;
  username?: string; // shown as its own copyable line
  password?: string; // temporary password, copyable
  name?: string; // with username and password: offer the ready-to-text login message
  permanent?: boolean; // the password is for good, not temporary
}

// Where a new person opens the app: this site's own address. In the demo, the
// demo's address, because that is where the made-up login works.
const appLink = () => (typeof window === 'undefined' ? '' : window.location.origin + (inDemo() ? '/?demo' : ''));

export function Staff({ session, restaurants, onDataChanged }: Props) {
  const owner = isOwner(session);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null); // the person whose sheet is open

  async function load() {
    try {
      const list = await api.listStaff();
      setPeople(owner ? list : list.filter((p) => p.restaurantId === session.restaurantId && p.role !== 'owner'));
    } catch (e) {
      setPeople([]);
      setError(e instanceof Error ? e.message : 'Could not load the staff list.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.username]);

  const groups = useMemo(() => {
    const byRest = new Map<string, Person[]>();
    for (const p of people ?? []) {
      const key = p.role === 'owner' ? 'all' : p.restaurantId;
      const list = byRest.get(key);
      if (list) list.push(p);
      else byRest.set(key, [p]);
    }
    const order = (r: StaffRole | 'owner') => ['owner', ...STAFF_ROLES].indexOf(r);
    for (const list of byRest.values()) list.sort((a, b) => order(a.role) - order(b.role) || a.displayName.localeCompare(b.displayName));
    const keys = ['all', ...restaurants.map((r) => r.id)].filter((k) => byRest.has(k));
    return keys.map((k) => ({ key: k, title: k === 'all' ? 'Owner' : (restaurants.find((r) => r.id === k)?.name ?? k), list: byRest.get(k)! }));
  }, [people, restaurants]);

  async function act(p: Person, action: ManageAction) {
    setBusy(p.username);
    setError(null);
    setNotice(null);
    try {
      const res = await api.manageStaff({ action, username: p.username });
      if (action === 'resetPassword') {
        setNotice({
          title: `New temporary password for ${p.displayName}. They will choose their own at the next sign-in.`,
          username: p.username,
          password: res.temporaryPassword,
          name: p.displayName,
        });
      }
      if (action === 'remove') setNotice({ title: `${p.displayName} (${p.username}) was removed. The login was never used, so nothing in the history refers to it.` });
      if (action === 'deactivate') setNotice({ title: `${p.displayName} is switched off and signed out. Their name stays in the history.` });
      if (action === 'reactivate') setNotice({ title: `${p.displayName} can sign in again.` });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(null);
      setSelected(null);
    }
  }

  async function seed() {
    setBusy('seed');
    setError(null);
    try {
      const res = await api.seedDemo();
      setNotice({
        title: `Loaded ${res.restaurants} restaurants, ${res.items} menu items, ${res.events} history entries and ${res.staff} staff logins.`,
        password: res.demoPassword,
      });
      setConfirmSeed(false);
      onDataChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Loading the demo data failed.');
    } finally {
      setBusy(null);
    }
  }

  // Owner only. Fills in what older rows are missing after an update that
  // changes the data shape. Safe to run any time.
  async function repair() {
    setBusy('repair');
    setError(null);
    try {
      const r = await api.repairData();
      setNotice({ title: `Repair done. Updated ${r.items} items (${r.openEvents} open history links), ${r.events} history entries and ${r.staff} staff rows.` });
      onDataChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The repair did not run.');
    } finally {
      setBusy(null);
    }
  }

  const empty = people !== null && people.filter((p) => p.role !== 'owner').length === 0;
  const count = people?.length ?? 0;

  return (
    <>
      <section className="sec" aria-label="Staff tools">
        <div className="toolbar">
          <span className="caption">
            {people === null ? 'Loading' : `${count} ${count === 1 ? 'login' : 'logins'}`}
            {owner ? ' across all restaurants' : ''}
          </span>
          <div className="actions">
            {owner && empty && api.mode === 'aws' && !confirmSeed && (
              <button type="button" className="btn btn-sm btn-outline" disabled={busy === 'seed'} onClick={() => setConfirmSeed(true)}>
                Load demo data
              </button>
            )}
            {owner && !empty && api.mode === 'aws' && (
              <button type="button" className="btn btn-sm btn-outline" disabled={busy === 'repair'} onClick={repair} title="Fills in anything older rows are missing. Safe any time.">
                {busy === 'repair' ? 'Repairing…' : 'Repair data'}
              </button>
            )}
            <button type="button" className={'btn btn-sm' + (showForm ? ' btn-outline' : '')} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Close' : 'Add a person'}
            </button>
          </div>
        </div>

        {error && (
          <p className="error center" role="alert">
            {error}
          </p>
        )}

        {confirmSeed && (
          <div className="notice" role="status">
            <span>Creates 3 restaurants, their menus, a week of history and 60 staff logins. Takes about 20 seconds.</span>
            <div className="actions">
              <button type="button" className="btn btn-sm btn-text" onClick={() => setConfirmSeed(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm" disabled={busy === 'seed'} onClick={seed}>
                {busy === 'seed' ? 'Loading…' : 'Yes, load it'}
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="notice" role="status">
            <div className="notice-row">
              <span>{notice.title}</span>
              <button type="button" className="btn btn-sm btn-text" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
            {notice.username && <CopyLine label="Username" value={notice.username} big />}
            {notice.password && <CopyLine label="Password" value={notice.password} big />}
            {notice.name && notice.username && notice.password && (
              <CopyMessage
                text={loginMessage({ name: notice.name, link: appLink(), username: notice.username, password: notice.password, temporary: !notice.permanent })}
              />
            )}
          </div>
        )}

        {showForm && (
          <AddForm
            session={session}
            restaurants={restaurants}
            onDone={async (n) => {
              setNotice(n);
              setShowForm(false);
              await load();
            }}
          />
        )}
      </section>

      {groups.map((g) => (
        <section key={g.key} className="course" aria-label={g.title}>
          <h3 className="course-head">{g.title}</h3>
          <ul className="list">
              {g.list.map((p) => {
                const isMe = p.username === session.username;
                const canAct = !isMe && (owner || p.role !== 'owner');
                const inner = (
                  <>
                    <span className="avatar" aria-hidden="true">
                      {initials(p.displayName)}
                    </span>
                    <span className="staff-text">
                      <span className="staff-name">
                        {p.displayName} {isMe && <span className="me-tag">You</span>}
                      </span>
                      <span className="staff-meta">
                        {p.username}, {ROLE_LABEL[p.role].toLowerCase()}
                      </span>
                    </span>
                    <span className="staff-trail">
                      {!p.active && <em className="state state-off">Off</em>}
                      {canAct && (
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      )}
                    </span>
                  </>
                );
                return (
                  <li key={p.username}>
                    {canAct ? (
                      <button type="button" className={'staff-row' + (p.active ? '' : ' is-off')} onClick={() => setSelected(p)} aria-haspopup="dialog">
                        {inner}
                      </button>
                    ) : (
                      <div className={'staff-row' + (p.active ? '' : ' is-off')}>{inner}</div>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {owner && <Automations />}

      {selected && (
        <PersonSheet
          person={selected}
          restaurantName={restaurants.find((r) => r.id === selected.restaurantId)?.name}
          busy={busy === selected.username}
          onAction={(action) => void act(selected, action)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// Tap a person, get their sheet: reset the password, switch them off or on,
// or remove a login that was never used. Switch off is the "cut them off"
// from the brief: signed out at once, name kept in the history.
function PersonSheet({
  person,
  restaurantName,
  busy,
  onAction,
  onClose,
}: {
  person: Person;
  restaurantName?: string;
  busy: boolean;
  onAction: (action: ManageAction) => void;
  onClose: () => void;
}) {
  const [armed, setArmed] = useState(false); // Remove needs a second tap

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="person-heading" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <div className={'sheet-person' + (person.active ? '' : ' is-off')}>
          <span className="avatar avatar-lg" aria-hidden="true">
            {initials(person.displayName)}
          </span>
          <h2 id="person-heading" className="sheet-title">
            {person.displayName}
          </h2>
          <span className="caption">
            {person.username}, {ROLE_LABEL[person.role].toLowerCase()}
            {restaurantName ? ` at ${restaurantName}` : ''}
            {person.active ? '' : ', switched off'}
          </span>
        </div>

        {person.active ? (
          <>
            <button type="button" className="btn btn-wide btn-outline" disabled={busy} onClick={() => onAction('resetPassword')}>
              Reset password
            </button>
            <button type="button" className="btn btn-wide btn-stamp" disabled={busy} onClick={() => onAction('deactivate')}>
              Switch off
            </button>
            <p className="hint center">Switch off signs them out right away. Their name stays in the history, and you can switch them back on later.</p>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-wide btn-sage" disabled={busy} onClick={() => onAction('reactivate')}>
              Switch on
            </button>
            <button type="button" className="btn btn-wide btn-stamp" disabled={busy} onClick={() => (armed ? onAction('remove') : setArmed(true))}>
              {armed ? 'Tap again to remove' : 'Remove login'}
            </button>
            <p className="hint center">Remove only works for a login that was never used.</p>
          </>
        )}

        <button type="button" className="btn btn-text btn-wide" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddForm({ session, restaurants, onDone }: { session: Session; restaurants: Restaurant[]; onDone: (n: Notice) => Promise<void> }) {
  const owner = isOwner(session);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [role, setRole] = useState<StaffRole>('server');
  const [restaurantId, setRestaurantId] = useState(owner ? (restaurants[0]?.id ?? '') : session.restaurantId);
  const [password, setPassword] = useState('');
  const [generated, setGenerated] = useState(false); // the password came from Generate and was not edited
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server's answer to "is this username free?": the first free one
  // from `asked`, e.g. asked marco.r, free marco.r2.
  const [check, setCheck] = useState<{ asked: string; free: string } | null>(null);

  const suggested = usernameFor(name);
  const base = touched ? username : suggested; // what we ask about
  const free = check && check.asked === base ? check.free : null; // null while checking
  const shown = touched ? username : (free ?? suggested); // what the box shows and what gets saved
  const takenTyped = touched && free !== null && free !== username;

  // Ask a moment after typing stops, so marco.r becomes marco.r2 before Create login.
  useEffect(() => {
    if (!base) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await api.manageStaff({ action: 'suggestUsername', username: base });
        if (!stale) setCheck({ asked: base, free: res.username });
      } catch {
        if (!stale) setCheck({ asked: base, free: base }); // could not ask; the server still checks on save
      }
    }, 350);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [base]);

  function generate() {
    setPassword(passwordFrom(randomInt));
    setGenerated(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const displayName = name.trim();
    const chosen = password.trim();
    try {
      const res = await api.manageStaff({ action: 'create', username: shown, displayName, role, restaurantId, password: chosen });
      await onDone(
        res.passwordSet
          ? { title: `${displayName} can sign in now with the password you chose.`, username: res.username, password: chosen, name: displayName, permanent: true }
          : {
              title: `${displayName} can sign in with this temporary password. They will choose their own the first time.`,
              username: res.username,
              password: res.temporaryPassword,
              name: displayName,
            },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const firstName = name.trim().split(/\s+/)[0] || 'They';

  return (
    <form className="panel form" onSubmit={submit}>
      <div className="form-row">
        <div className="field">
          <label className="field-label" htmlFor="add-name">
            Name
          </label>
          <input id="add-name" className="input" type="text" placeholder="Marco R." value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="add-user">
            Username
          </label>
          <input
            id="add-user"
            className="input"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="marco.r"
            value={shown}
            onChange={(e) => {
              setTouched(true);
              setUsername(cleanUsername(e.target.value));
            }}
            required
          />
          {shown &&
            (free === null ? (
              <span className="hint">Checking it is free…</span>
            ) : takenTyped ? (
              <span className="hint hint-warn">
                {username} is taken.{' '}
                <button type="button" className="link-btn hint-btn" onClick={() => setUsername(free)}>
                  Use {free}
                </button>
              </span>
            ) : !touched && free !== suggested ? (
              <span className="hint hint-ok">
                {suggested} is taken, so {firstName} gets <b>{free}</b>
              </span>
            ) : (
              <span className="hint hint-ok">
                {touched ? 'Free. ' : ''}They sign in with: <b>{shown}</b>
              </span>
            ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Role</span>
        <div className="tags tags-left" role="radiogroup" aria-label="Role">
          {STAFF_ROLES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} className={'tag' + (role === r ? ' is-on' : '')} onClick={() => setRole(r)}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <span className="hint">{role === 'manager' || role === 'kitchen' ? 'Can change the board.' : 'Can see the board, cannot change it.'}</span>
      </div>

      {owner && (
        <div className="field">
          <span className="field-label">Restaurant</span>
          <div className="tags tags-left" role="radiogroup" aria-label="Restaurant">
            {restaurants.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={restaurantId === r.id}
                className={'tag' + (restaurantId === r.id ? ' is-on' : '')}
                onClick={() => setRestaurantId(r.id)}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="add-pass">
          Password, optional
        </label>
        <div className="input-with-btn">
          <input
            id="add-pass"
            className="input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Leave empty"
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setGenerated(false);
            }}
          />
          <button type="button" className="btn btn-sm btn-amber" onClick={generate}>
            Generate
          </button>
        </div>
        <span className="hint">
          {generated
            ? 'Strong, and easy to read out loud. This becomes their password. Tap Generate for another.'
            : password.trim()
              ? 'This becomes their password. At least 8 characters with a capital letter, a number and a symbol.'
              : 'Empty means they get a temporary password and choose their own at first sign-in.'}
        </span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="btn" disabled={busy || !name.trim() || !shown || !restaurantId || free === null || takenTyped}>
          {busy ? 'Creating…' : 'Create login'}
        </button>
      </div>
    </form>
  );
}
