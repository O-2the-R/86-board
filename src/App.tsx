// The screen shell: who is signed in, which restaurant, and the three
// sections (Board, History, Staff). The login decides what you can touch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Restaurant, Session } from './types';
import { ROLE_LABEL, canEditBoard, canManageStaff, canSeeRestaurant, isOwner } from './types';
import { api } from './api';
import { resetSampleData } from './api/mock';
import { closeDemo, inDemo } from './lib/demo';
import { readString, writeString } from './lib/storage';
import { initials } from './lib/format';
import { useBoard } from './hooks/useBoard';
import { AlertsBell, AlertsNudge, AlertsSheet, useAlerts } from './components/Alerts';
import { Board } from './components/Board';
import { Freshness } from './components/Freshness';
import { History } from './components/History';
import { Login } from './components/Login';
import { Staff } from './components/Staff';
import { RESTAURANTS as SAMPLE_RESTAURANTS } from '../shared/sample-data';

type Tab = 'board' | 'history' | 'staff';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = still checking
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);

  const loadSession = useCallback(async () => {
    const s = await api.currentSession();
    setSession(s);
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const loadRestaurants = useCallback(async () => {
    try {
      setRestaurants(await api.listRestaurants());
    } catch {
      setRestaurants([]);
    }
  }, []);

  useEffect(() => {
    if (session) void loadRestaurants();
  }, [session, loadRestaurants]);

  async function signOut(reason?: string) {
    await api.signOut();
    setSignedOutReason(reason ?? null);
    setSession(null);
  }

  if (session === undefined) {
    return <p className="caption center" style={{ paddingTop: 80 }}>Loading…</p>;
  }

  if (!session) {
    return (
      <>
        {signedOutReason && (
          <p className="error center" role="alert" style={{ paddingTop: 16 }}>
            {signedOutReason}
          </p>
        )}
        <Login
          restaurants={restaurants.length ? restaurants : SAMPLE_RESTAURANTS}
          onSignedIn={() => {
            setSignedOutReason(null);
            void loadSession();
          }}
        />
      </>
    );
  }

  return <Shell session={session} restaurants={restaurants} reloadRestaurants={loadRestaurants} onSignOut={signOut} />;
}

interface ShellProps {
  session: Session;
  restaurants: Restaurant[];
  reloadRestaurants: () => Promise<void>;
  onSignOut: (reason?: string) => Promise<void>;
}

function Shell({ session, restaurants, reloadRestaurants, onSignOut }: ShellProps) {
  const visible = useMemo(() => restaurants.filter((r) => canSeeRestaurant(session, r.id)), [restaurants, session]);
  const storageKey = `eightysix.restaurant.${session.username}`;
  const [restaurantId, setRestaurantId] = useState<string>(() => readString(storageKey) ?? '');
  const [tab, setTab] = useState<Tab>('board');
  const [historyKey, setHistoryKey] = useState(0);
  const alerts = useAlerts(session.username);

  // Land on the first restaurant this person can see.
  useEffect(() => {
    if (visible.length === 0) return;
    if (!visible.some((r) => r.id === restaurantId)) setRestaurantId(visible[0].id);
  }, [visible, restaurantId]);

  useEffect(() => {
    if (restaurantId) writeString(storageKey, restaurantId);
  }, [restaurantId, storageKey]);

  const onRevoked = useCallback(() => {
    void onSignOut('Your account has been switched off. Ask a manager if that is a mistake.');
  }, [onSignOut]);

  const { items, lastOk, failing, loading, refresh } = useBoard(visible.some((r) => r.id === restaurantId) ? restaurantId : '', {
    username: session.username,
    onRevoked,
  });

  const restaurant = visible.find((r) => r.id === restaurantId);
  const canEdit = restaurant ? canEditBoard(session, restaurant.id) : false;
  const manages = canManageStaff(session);
  const outCount = useMemo(() => items.filter((i) => i.status === 'out').length, [items]);
  const noRestaurants = restaurants.length === 0;

  useEffect(() => {
    // A fresh backend has no restaurants yet; the owner lands on Staff to load them.
    if (noRestaurants && isOwner(session)) setTab('staff');
  }, [noRestaurants, session]);

  function onChanged() {
    void refresh();
    setHistoryKey((k) => k + 1);
  }

  function resetSample() {
    resetSampleData();
    onChanged();
    void reloadRestaurants();
  }

  // Demo: sign out first, then wipe the sample data, so the board never sees
  // the guest disappear mid-refresh.
  async function startOverDemo() {
    await onSignOut();
    resetSampleData();
  }

  async function exitDemo() {
    await onSignOut();
    resetSampleData();
    closeDemo();
  }

  const titles: Record<Tab, string> = {
    board: restaurant ? restaurant.name : '86 Board',
    history: 'History',
    staff: 'Staff',
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="who">
            <span className="avatar" aria-hidden="true">
              {initials(session.displayName)}
            </span>
            <span className="who-text">
              <span className="who-name">{session.displayName}</span>
              <span className="who-role">
                {ROLE_LABEL[session.role]}
                {restaurant && session.role !== 'owner' ? ` at ${restaurant.name}` : ''}
              </span>
            </span>
          </div>
          <div className="topbar-actions">
            <AlertsBell state={alerts.state} onClick={() => alerts.setOpen(true)} />
            <button type="button" className="link-btn" onClick={() => void onSignOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="page">
        <div className="masthead">
          <h1 className="large-title">{titles[tab]}</h1>
          {tab === 'board' && restaurant && <Freshness lastOk={lastOk} failing={failing} />}
          {tab === 'history' && restaurant && <span className="caption">{restaurant.name}</span>}
          {visible.length > 1 && (
            <div className="seg" role="tablist" aria-label="Restaurant">
              {visible.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={r.id === restaurantId}
                  className={'seg-btn' + (r.id === restaurantId ? ' is-on' : '')}
                  onClick={() => setRestaurantId(r.id)}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <main className="stack">
          {tab === 'board' && restaurant && <AlertsNudge state={alerts.state} onOpen={() => alerts.setOpen(true)} />}
          {tab === 'board' &&
            (restaurant ? (
              <Board items={items} canEdit={canEdit} actor={session.displayName} loading={loading} onChanged={onChanged} />
            ) : (
              <NoRestaurant session={session} goStaff={() => setTab('staff')} />
            ))}
          {tab === 'history' && (restaurant ? <History restaurantId={restaurant.id} refreshKey={historyKey} /> : <NoRestaurant session={session} goStaff={() => setTab('staff')} />)}
          {tab === 'staff' && manages && <Staff session={session} restaurants={restaurants} onDataChanged={() => void reloadRestaurants()} />}

          {inDemo() ? (
            <footer className="foot">
              <p>Demo with sample restaurants. Everything you do stays on this phone. Nothing reaches a real kitchen, and no alerts are sent.</p>
              <div className="foot-actions">
                <button type="button" className="link-btn" style={{ paddingLeft: 0 }} onClick={() => void startOverDemo()}>
                  Start over
                </button>
                <button type="button" className="link-btn" onClick={() => void exitDemo()}>
                  Exit demo
                </button>
              </div>
            </footer>
          ) : api.mode === 'sample' && (
            <footer className="foot">
              <p>Preview with sample data. Your taps are saved on this device only. The real app shares one board across every phone.</p>
              <button type="button" className="link-btn" style={{ paddingLeft: 0 }} onClick={resetSample}>
                Reset sample data
              </button>
            </footer>
          )}
        </main>
      </div>

      <nav className="tabbar" aria-label="Sections">
        <div className="tabbar-inner">
          <button type="button" className={'tab' + (tab === 'board' ? ' is-on' : '')} onClick={() => setTab('board')} aria-current={tab === 'board'}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="4" width="17" height="16" rx="3" />
              <path d="M7.5 9h9M7.5 13h9M7.5 17h5" />
            </svg>
            Board
            {outCount > 0 && <span className="tab-badge num">{outCount}</span>}
          </button>
          <button type="button" className={'tab' + (tab === 'history' ? ' is-on' : '')} onClick={() => setTab('history')} aria-current={tab === 'history'}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            History
          </button>
          {manages && (
            <button type="button" className={'tab' + (tab === 'staff' ? ' is-on' : '')} onClick={() => setTab('staff')} aria-current={tab === 'staff'}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8.5" r="3.5" />
                <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M16 5a3.5 3.5 0 0 1 0 7M21.5 20c0-3-2-5.5-4.8-6.3" />
              </svg>
              Staff
            </button>
          )}
        </div>
      </nav>

      {alerts.open && (
        <AlertsSheet
          state={alerts.state}
          restaurantName={session.role === 'owner' ? undefined : restaurant?.name}
          onChange={(s) => alerts.setState(s)}
          onClose={() => alerts.setOpen(false)}
        />
      )}
    </>
  );
}

function NoRestaurant({ session, goStaff }: { session: Session; goStaff: () => void }) {
  return (
    <section className="panel">
      <div className="empty">
        {isOwner(session) ? (
          <>
            <b>No restaurants yet</b>
            <span>Load the demo data from Staff to set up the three restaurants, their menus and the logins.</span>
            <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={goStaff}>
              Go to Staff
            </button>
          </>
        ) : (
          <>
            <b>No restaurant assigned</b>
            <span>Your login is not attached to a restaurant yet. Ask a manager to fix it.</span>
          </>
        )}
      </div>
    </section>
  );
}
