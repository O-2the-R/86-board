// The screen shell: who is signed in, which restaurant, and the three
// sections (Board, History, Staff). The login decides what you can touch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Restaurant, Session } from './types';
import { ROLE_LABEL, canEditBoard, canManageStaff, canSeeRestaurant, isOwner } from './types';
import { api } from './api';
import { resetSampleData } from './api/mock';
import { readString, writeString } from './lib/storage';
import { useBoard } from './hooks/useBoard';
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
    return <p className="hint center" style={{ paddingTop: 80 }}>One moment…</p>;
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

  return (
    <>
      <div className="page">
        <header>
          <div className="util">
            <span className="eyebrow">
              {session.displayName} · {ROLE_LABEL[session.role]}
            </span>
            <button type="button" className="link-caps eyebrow" onClick={() => void onSignOut()}>
              Sign out
            </button>
          </div>

          <div className="masthead" style={{ marginTop: 14 }}>
            <h1 className="display masthead-title">{restaurant ? restaurant.name : '86 Board'}</h1>
            <div className="double-rule" aria-hidden="true" />
            {restaurant && <Freshness lastOk={lastOk} failing={failing} />}
            {visible.length > 1 && (
              <nav className="rnav" aria-label="Restaurant">
                {visible.map((r, i) => (
                  <span key={r.id} style={{ display: 'contents' }}>
                    {i > 0 && (
                      <span className="rnav-sep" aria-hidden="true">
                        ·
                      </span>
                    )}
                    <button type="button" className={'rnav-btn' + (r.id === restaurantId ? ' is-on' : '')} onClick={() => setRestaurantId(r.id)}>
                      {r.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}
          </div>
        </header>

        <main style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {tab === 'board' &&
            (restaurant ? (
              <Board items={items} canEdit={canEdit} actor={session.displayName} loading={loading} onChanged={onChanged} />
            ) : (
              <NoRestaurant session={session} goStaff={() => setTab('staff')} />
            ))}
          {tab === 'history' && (restaurant ? <History restaurantId={restaurant.id} refreshKey={historyKey} /> : <NoRestaurant session={session} goStaff={() => setTab('staff')} />)}
          {tab === 'staff' && manages && <Staff session={session} restaurants={restaurants} onDataChanged={() => void reloadRestaurants()} />}

          {api.mode === 'sample' && (
            <footer className="foot">
              <p>Preview with sample data. Your taps are saved on this device only. The real app shares one board across every phone.</p>
              <button type="button" className="link-caps" style={{ alignSelf: 'flex-start' }} onClick={resetSample}>
                Reset sample data
              </button>
            </footer>
          )}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Sections">
        <div className="bottom-nav-inner">
          <button type="button" className={'nav-btn' + (tab === 'board' ? ' is-on' : '')} onClick={() => setTab('board')}>
            Board
            {outCount > 0 && <span className="nav-count">{outCount}</span>}
          </button>
          <button type="button" className={'nav-btn' + (tab === 'history' ? ' is-on' : '')} onClick={() => setTab('history')}>
            History
          </button>
          {manages && (
            <button type="button" className={'nav-btn' + (tab === 'staff' ? ' is-on' : '')} onClick={() => setTab('staff')}>
              Staff
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

function NoRestaurant({ session, goStaff }: { session: Session; goStaff: () => void }) {
  if (isOwner(session)) {
    return (
      <section className="sec">
        <h2 className="sec-head">No restaurants yet</h2>
        <p className="allgood">
          Load the demo data from the Staff section to set up the three restaurants, their menus and the staff logins.
        </p>
        <div className="form-actions" style={{ marginTop: 14, justifyContent: 'center' }}>
          <button type="button" className="btn btn-ink" onClick={goStaff}>
            Go to Staff
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="sec">
      <h2 className="sec-head">No restaurant assigned</h2>
      <p className="allgood">Your login is not attached to a restaurant yet. Ask a manager to fix it.</p>
    </section>
  );
}
