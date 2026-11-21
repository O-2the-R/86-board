// "Your restaurant", on the owner's Staff screen. A new site starts with
// three sample restaurants and 60 demo logins. Here the owner turns it into
// one real restaurant: pick the lists file, name the restaurant, say yes.
// The steps run one after another and each can be run again, so a dropped
// connection never leaves the site stuck halfway:
//   1. name the restaurant (it takes the first slot)
//   2. load its lists (Ask answers from them, privately)
//   3. remove the sample restaurants, their data and the demo logins
//   4. put the lists' items on the 86 board
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api';
import type { SiteStatus } from '../api/types';
import { BadLists, cleanCatalog, countsOf, parseLists } from '../../shared/assistant/load';

interface Props {
  onChanged: () => void; // restaurants, the board or Ask changed
}

interface Picked {
  fileName: string;
  text: string;
  items: number;
  notes: number;
}

const n = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export function OwnRestaurant({ onChanged }: Props) {
  const [site, setSite] = useState<SiteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]); // what has been done, one line each
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    api.getSite().then(
      (s) => {
        setSite(s);
        if (s.own) setName(s.own.name);
        return s;
      },
      (e: unknown) => {
        setError(e instanceof Error && e.message ? e.message : 'Could not load this.');
        return null;
      },
    );

  // once, when the screen opens
  useEffect(() => {
    void refresh();
  }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const lists = cleanCatalog('own', parseLists(text), 'today');
      setPicked({ fileName: file.name, text, ...countsOf(lists) });
      if (lists.restaurant && !name.trim()) setName(lists.restaurant);
    } catch (err) {
      setPicked(null);
      setError(err instanceof BadLists ? err.message : 'That file could not be read. Pick it again.');
    }
  }

  const leftovers = site ? site.toRemove.restaurants + site.toRemove.items + site.toRemove.history + site.toRemove.vendors + site.toRemove.logins : 0;

  // Removes the sample data in rounds until the server says it is done.
  async function removeAll(say: (line: string) => void) {
    for (let round = 0; round < 40; round++) {
      const res = await api.removeSamples();
      if (res.done) return say('Removed the sample restaurants, their data and the demo logins.');
      say(`Removing the sample data: ${res.left.toLocaleString('en-US')} to go…`);
    }
    throw new Error('Removing the sample data is taking too long. Press the button again to carry on.');
  }

  async function run(work: (say: (line: string) => void) => Promise<void>) {
    setBusy(true);
    setError(null);
    setConfirming(false);
    setSteps([]);
    // a "… to go" line is replaced by the next one; finished steps stay
    const say = (line: string) => setSteps((now) => [...now.filter((l) => !l.endsWith('…')), line]);
    try {
      await work(say);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That did not finish. Press the button again to carry on.');
    } finally {
      setBusy(false);
      await refresh();
      onChanged();
    }
  }

  const setUp = () =>
    run(async (say) => {
      if (!picked) return;
      const own = await api.setUpRestaurant(name);
      say(`Named your restaurant ${own.name}.`);
      await api.loadAskLists(own.id, picked.text);
      say(`Loaded your lists: ${n(picked.items, 'item', 'items')}.`);
      await removeAll(say);
      const board = await api.syncMenu(own.id);
      say(`Put ${n(board.total, 'item', 'items')} on the 86 board.`);
      setPicked(null);
    });

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void run(async (say) => {
      const own = await api.setUpRestaurant(name);
      say(`The name is now ${own.name}.`);
    });
  };

  // After an interrupted set-up: finish the removal, then fill the board.
  const finishRemoving = () =>
    run(async (say) => {
      await removeAll(say);
      const own = (await api.getSite()).own;
      if (!own) return;
      const board = await api.syncMenu(own.id);
      say(`Put ${n(board.total, 'item', 'items')} on the 86 board.`);
    });

  const toGo = site && (
    <>
      {n(site.toRemove.restaurants + (site.own ? 0 : 1), 'sample restaurant', 'sample restaurants')}, {n(site.toRemove.items, 'menu item', 'menu items')},{' '}
      {n(site.toRemove.history, 'history entry', 'history entries')}, {n(site.toRemove.vendors, 'vendor contact', 'vendor contacts')} and {n(site.toRemove.logins, 'login', 'logins')}
    </>
  );

  return (
    <section className="sec" aria-labelledby="own-heading">
      <div className="sec-head">
        <h2 id="own-heading" className="sec-title">
          Your restaurant
        </h2>
        {site?.own && <span className="caption ok-text">Set up</span>}
      </div>

      <div className="panel form">
        {site === null && !error && <p className="caption">Loading…</p>}

        {site && !site.own && (
          <>
            <p className="form-intro">
              This site has the three sample restaurants. You can make it yours: one restaurant, with its real menu on the 86 board. The menu comes from your lists file, the same one
              Ask answers from. The sample restaurants and the demo logins are then removed from this site. The public demo keeps them.
            </p>
            {site.locked ? (
              <p className="hint">This is the staging copy. It keeps the sample restaurants so its security test can run. Set up your restaurant on the live site.</p>
            ) : (
              <>
                <div className="actions actions-left">
                  <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                    {picked ? 'Pick another file' : 'Pick your lists file'}
                  </button>
                  {picked && (
                    <span className="caption">
                      {picked.fileName}: {n(picked.items, 'item', 'items')}, {n(picked.notes, 'house note', 'house notes')}.
                    </span>
                  )}
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="own-name">
                    Name of your restaurant
                  </label>
                  <input id="own-name" className="input" type="text" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                {!confirming && (
                  <div className="actions">
                    <button type="button" className="btn" disabled={busy || !picked || name.trim().length < 2} onClick={() => setConfirming(true)}>
                      {busy ? 'Working…' : 'Set up my restaurant'}
                    </button>
                  </div>
                )}
                {confirming && picked && (
                  <div className="notice" role="status">
                    <span>
                      {name.trim()} becomes the only restaurant here, with {n(picked.items, 'item', 'items')} on its board. Removed from this site for good: {toGo}. Your own login
                      stays.
                    </span>
                    <div className="actions">
                      <button type="button" className="btn btn-sm btn-text" onClick={() => setConfirming(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => void setUp()}>
                        Yes, set it up
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {site?.own && (
          <>
            <form className="field" onSubmit={rename}>
              <label className="field-label" htmlFor="own-name">
                Name
              </label>
              <input id="own-name" className="input" type="text" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="actions">
                <button type="submit" className="btn btn-sm btn-outline" disabled={busy || name.trim().length < 2 || name.trim() === site.own.name}>
                  Save the name
                </button>
              </div>
            </form>
            <p className="hint">The 86 board's menu comes from the lists under Ask, below. Load new lists there and the board follows.</p>
            {leftovers > 0 && !busy && (
              <div className="notice" role="status">
                <span>Sample data is still on this site: {toGo}.</span>
                <div className="actions">
                  <button type="button" className="btn btn-sm" onClick={() => void finishRemoving()}>
                    Remove it
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {steps.length > 0 && (
          <ul className="own-steps" aria-live="polite">
            {steps.map((line) => (
              <li key={line} className={line.endsWith('…') ? 'caption' : 'caption ok-text'}>
                {line}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e)} />
      </div>
    </section>
  );
}
