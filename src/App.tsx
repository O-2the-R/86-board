// The screen shell: header (brand, freshness, restaurant), who you are,
// the Board / History tabs, and the footer note.
import { useEffect, useMemo, useState } from 'react';
import type { Restaurant, Role } from './types';
import { canEditRole } from './types';
import { api } from './api';
import { resetSampleData } from './api/mock';
import { readString, writeString } from './lib/storage';
import { useBoard } from './hooks/useBoard';
import { Board } from './components/Board';
import { Freshness } from './components/Freshness';
import { History } from './components/History';
import { Segmented } from './components/Segmented';

// Prototype only. In the real app the login decides who you are.
const ROLES: { value: Role; label: string; actor: string }[] = [
  { value: 'manager', label: 'Manager', actor: 'Priya M.' },
  { value: 'kitchen', label: 'Kitchen', actor: 'Marco R.' },
  { value: 'server', label: 'Server', actor: 'Sam T.' },
  { value: 'host', label: 'Host', actor: 'Lena K.' },
];

type Tab = 'board' | 'history';

export default function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>(() => readString('eightysix.restaurant') ?? 'main');
  const [role, setRole] = useState<Role>(() => (readString('eightysix.role') as Role | null) ?? 'server');
  const [tab, setTab] = useState<Tab>('board');
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    api.listRestaurants().then(setRestaurants).catch(() => setRestaurants([]));
  }, []);
  useEffect(() => writeString('eightysix.restaurant', restaurantId), [restaurantId]);
  useEffect(() => writeString('eightysix.role', role), [role]);

  const { items, lastOk, failing, loading, refresh } = useBoard(restaurantId, 5000);
  const restaurant = restaurants.find((r) => r.id === restaurantId);
  const who = ROLES.find((r) => r.value === role) ?? ROLES[2];
  const canEdit = canEditRole(role);
  const outCount = useMemo(() => items.filter((i) => i.status === 'out').length, [items]);

  function onChanged() {
    void refresh();
    setHistoryKey((k) => k + 1);
  }

  function reset() {
    resetSampleData();
    onChanged();
  }

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand-row">
            <div className="brand" aria-label="86 Board">
              <span className="brand-86">86</span>
              <span className="brand-word">Board</span>
            </div>
            <Freshness lastOk={lastOk} failing={failing} />
          </div>
          <Segmented
            id="restaurant"
            label="Restaurant"
            value={restaurantId}
            options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
            onChange={setRestaurantId}
          />
        </div>
      </header>

      <main className="page">
        <div className="who">
          <span className="who-label">Viewing as</span>
          <Segmented id="role" label="Role" value={role} options={ROLES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRole} />
          <span className="who-note">{canEdit ? `${who.actor} · can update the board` : `${who.actor} · view only`}</span>
        </div>

        <nav className="tabs" aria-label="Sections">
          <button type="button" className={'tab' + (tab === 'board' ? ' is-on' : '')} onClick={() => setTab('board')}>
            Board
            {outCount > 0 && <span className="tab-badge">{outCount}</span>}
          </button>
          <button type="button" className={'tab' + (tab === 'history' ? ' is-on' : '')} onClick={() => setTab('history')}>
            History
          </button>
        </nav>

        {tab === 'board' ? (
          <Board items={items} canEdit={canEdit} actor={who.actor} loading={loading} onChanged={onChanged} />
        ) : (
          <History restaurantId={restaurantId} refreshKey={historyKey} />
        )}

        <footer className="foot">
          <p>
            Prototype with sample data{restaurant ? ` for ${restaurant.name} (${restaurant.kind.toLowerCase()})` : ''}. Your taps are saved on
            this device only. In the real app, your login sets your role and everyone shares one board.
          </p>
          <button type="button" className="link" onClick={reset}>
            Reset sample data
          </button>
        </footer>
      </main>
    </>
  );
}
