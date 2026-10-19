// Who has a login, and the switch to cut someone off. Owners see every
// restaurant; managers see their own. Nobody is ever deleted: the history
// keeps their name.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Restaurant, Session, Staff as Person, StaffRole } from '../types';
import { ROLE_LABEL, STAFF_ROLES, isOwner } from '../types';
import { api } from '../api';
import type { ManageAction } from '../api/types';
import { usernameFor } from '../../shared/sample-data';

interface Props {
  session: Session;
  restaurants: Restaurant[];
  onDataChanged: () => void; // after demo data loads
}

interface Notice {
  title: string;
  password?: string;
}

export function Staff({ session, restaurants, onDataChanged }: Props) {
  const owner = isOwner(session);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);

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
      if (action === 'resetPassword') setNotice({ title: `Temporary password for ${p.displayName}. They will choose their own at next sign-in.`, password: res.temporaryPassword });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function seed() {
    setBusy('seed');
    setError(null);
    try {
      const res = await api.seedDemo();
      setNotice({
        title: `Loaded ${res.restaurants} restaurants, ${res.items} menu items, ${res.events} history entries and ${res.staff} staff logins. Sample staff password: ${res.demoPassword}`,
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

  const empty = people !== null && people.filter((p) => p.role !== 'owner').length === 0;

  return (
    <>
      <section className="sec" aria-labelledby="staff-heading">
        <h2 id="staff-heading" className="sec-head">
          Staff
        </h2>
        <div className="sec-sub caps-sm">
          {people === null ? 'Loading' : `${people.length} ${people.length === 1 ? 'login' : 'logins'}`}
          {owner ? ' across all restaurants' : ''}
        </div>

        {error && (
          <p className="error center" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}

        {notice && (
          <div className="notice" role="status">
            <div className="notice-row">
              <span>{notice.title}</span>
              <button type="button" className="btn btn-sm btn-text" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
            {notice.password && <PasswordLine password={notice.password} />}
          </div>
        )}

        <div className="form-actions" style={{ marginTop: 14 }}>
          {owner && empty && api.mode === 'aws' && !confirmSeed && (
            <button type="button" className="btn" disabled={busy === 'seed'} onClick={() => setConfirmSeed(true)}>
              Load demo data
            </button>
          )}
          {confirmSeed && (
            <>
              <span className="hint">Creates 3 restaurants, their menus, a week of history and 60 staff logins.</span>
              <button type="button" className="btn btn-text" onClick={() => setConfirmSeed(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-ink" disabled={busy === 'seed'} onClick={seed}>
                {busy === 'seed' ? 'Loading, about 20 seconds' : 'Yes, load it'}
              </button>
            </>
          )}
          <button type="button" className={'btn' + (showForm ? ' btn-text' : ' btn-ink')} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'Add a person'}
          </button>
        </div>

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
        <section key={g.key} className="sec" aria-label={g.title}>
          <h3 className="course-head display-caps">{g.title}</h3>
          <ul>
            {g.list.map((p) => {
              const isMe = p.username === session.username;
              const canAct = !isMe && (owner || p.role !== 'owner');
              return (
                <li key={p.username} className={'staff-row' + (p.active ? '' : ' is-off')}>
                  <div className="staff-main">
                    <span className="staff-name">
                      {p.displayName} {isMe && <span className="me-tag">you</span>}
                    </span>
                    <span className="staff-meta">
                      {p.username} · {ROLE_LABEL[p.role]}
                      {p.active ? '' : ' · switched off'}
                    </span>
                  </div>
                  {canAct && (
                    <div className="staff-actions">
                      {p.active && (
                        <button type="button" className="btn btn-sm btn-text" disabled={busy === p.username} onClick={() => act(p, 'resetPassword')}>
                          Reset password
                        </button>
                      )}
                      <button
                        type="button"
                        className={'btn btn-sm' + (p.active ? '' : ' btn-ink')}
                        disabled={busy === p.username}
                        onClick={() => act(p, p.active ? 'deactivate' : 'reactivate')}
                      >
                        {p.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function PasswordLine({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the password text is selectable; the person can copy it by hand
    }
  }
  return (
    <div className="notice-row">
      <span className="notice-pass">{password}</span>
      <button type="button" className="btn btn-sm" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = usernameFor(name);
  const finalUsername = touched ? username : suggested;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.manageStaff({ action: 'create', username: finalUsername, displayName: name.trim(), role, restaurantId });
      await onDone({
        title: `${name.trim()} can sign in as ${res.username} with this temporary password. They will choose their own the first time.`,
        password: res.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
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
            value={finalUsername}
            onChange={(e) => {
              setTouched(true);
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
            }}
            required
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Role</span>
        <div className="chips" style={{ justifyContent: 'flex-start' }} role="radiogroup" aria-label="Role">
          {STAFF_ROLES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} className={'chip' + (role === r ? ' is-on' : '')} onClick={() => setRole(r)}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <span className="hint">{role === 'manager' || role === 'kitchen' ? 'Can change the board.' : 'Can see the board, cannot change it.'}</span>
      </div>

      {owner && (
        <div className="field">
          <span className="field-label">Restaurant</span>
          <div className="chips" style={{ justifyContent: 'flex-start' }} role="radiogroup" aria-label="Restaurant">
            {restaurants.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={restaurantId === r.id}
                className={'chip' + (restaurantId === r.id ? ' is-on' : '')}
                onClick={() => setRestaurantId(r.id)}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-ink" disabled={busy || !name.trim() || !finalUsername || !restaurantId}>
          {busy ? 'Creating' : 'Create login'}
        </button>
      </div>
    </form>
  );
}
