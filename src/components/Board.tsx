// The board itself: what is eighty-sixed on top, the full menu by course
// below. Editors tap an item to 86 it (with an optional note) and tap
// "Back on" when it returns. Everyone else only reads.
import { useEffect, useMemo, useState } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { fmtDuration, fmtTime } from '../lib/format';

const QUICK_NOTES = ['Sold out', "Didn't come in", 'Vendor short', 'Quality, pulled', 'Back tomorrow'];
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

interface Props {
  items: MenuItem[];
  canEdit: boolean;
  actor: string; // name recorded on the change
  loading: boolean;
  onChanged: () => void; // ask for a fresh board right away
}

export function Board({ items, canEdit, actor, loading, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<MenuItem | null>(null); // item about to be 86'd
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const out = useMemo(
    () => items.filter((i) => i.status === 'out').sort((a, b) => (b.outSince ?? '').localeCompare(a.outSince ?? '')),
    [items],
  );

  const q = query.trim().toLowerCase();
  const courses = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const it of items) {
      if (q && !it.name.toLowerCase().includes(q) && !it.category.toLowerCase().includes(q)) continue;
      const list = map.get(it.category);
      if (list) list.push(it);
      else map.set(it.category, [it]);
    }
    return [...map.entries()];
  }, [items, q]);

  async function run(id: string, work: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const back = (item: MenuItem) => run(item.id, () => api.markBack(item.id, actor));

  function confirmOut(note: string) {
    if (!target) return;
    const item = target;
    setTarget(null);
    void run(item.id, () => api.markOut(item.id, note, actor));
  }

  const countWord = out.length <= 10 ? COUNT_WORDS[out.length] : String(out.length);

  return (
    <>
      <section className="sec" aria-labelledby="out-heading">
        <h2 id="out-heading" className="sec-head is-86">
          Eighty-sixed this evening
        </h2>
        <div className="sec-sub caps-sm">
          {loading && items.length === 0 ? 'Loading' : `${countWord} ${out.length === 1 ? 'item' : 'items'}`}
        </div>

        {error && (
          <p className="error center" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}

        {!loading && out.length === 0 ? (
          <p className="allgood">Nothing is eighty-sixed. The whole menu is available.</p>
        ) : (
          <ul className="ledger">
            {out.map((it) => (
              <li key={it.id} className="ledger-row">
                <div className="ledger-main">
                  <div className="ledger-name">{it.name}</div>
                  {it.note && <div className="ledger-note">{it.note}</div>}
                  {it.markedBy && <div className="ledger-by">{it.markedBy}</div>}
                </div>
                <div className="ledger-side">
                  {it.outSince && (
                    <div className="ledger-time">
                      {fmtTime(it.outSince)} · {fmtDuration(now - Date.parse(it.outSince))}
                    </div>
                  )}
                  {canEdit && (
                    <button type="button" className="btn btn-sm" disabled={busyId === it.id} onClick={() => back(it)}>
                      Back on
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sec" aria-labelledby="menu-heading">
        <h2 id="menu-heading" className="sr-only">
          Full menu
        </h2>
        <div className="menu-tools">
          <p className="hint">{canEdit ? 'Tap an item to eighty-six it.' : 'View only. Managers and kitchen update the board.'}</p>
          <input
            id="menu-search"
            className="search"
            type="search"
            placeholder="Search the menu"
            aria-label="Search the menu"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {courses.map(([course, list]) => (
          <div key={course} className="course">
            <h3 className="course-head display-caps">{course}</h3>
            <ul>
              {list.map((it) => {
                const isOut = it.status === 'out';
                const status = isOut ? <span className="status-out">86'd</span> : <span className="status-ok caps-sm">Available</span>;
                return (
                  <li key={it.id} className={'menu-row' + (isOut ? ' is-out' : '')}>
                    {canEdit && !isOut ? (
                      <button type="button" className="menu-row-inner" disabled={busyId === it.id} onClick={() => setTarget(it)}>
                        <span className="menu-name">{it.name}</span>
                        {status}
                      </button>
                    ) : (
                      <div className="menu-row-inner">
                        <span className="menu-name">{it.name}</span>
                        {isOut && canEdit ? (
                          <button type="button" className="btn btn-sm" disabled={busyId === it.id} onClick={() => back(it)}>
                            Back on
                          </button>
                        ) : (
                          status
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!loading && courses.length === 0 && <p className="hint center" style={{ marginTop: 16 }}>No items match “{query}”.</p>}
      </section>

      {target && <OutSheet item={target} onCancel={() => setTarget(null)} onConfirm={confirmOut} />}
    </>
  );
}

// The sheet that confirms an 86. Confirmation lives in the page because
// browser pop-ups are not available everywhere the app runs.
function OutSheet({ item, onCancel, onConfirm }: { item: MenuItem; onCancel: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-heading" onClick={(e) => e.stopPropagation()}>
        <h2 id="sheet-heading" className="sheet-title display italic">
          Eighty-six {item.name}?
        </h2>
        <p className="hint center">Everyone sees it within five seconds.</p>
        <div className="chips">
          {QUICK_NOTES.map((n) => (
            <button key={n} type="button" className={'chip' + (note === n ? ' is-on' : '')} onClick={() => setNote(note === n ? '' : n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sheet-note">
            Note, optional
          </label>
          <input id="sheet-note" className="input" type="text" placeholder="Out until Thursday delivery" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-text" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-ox" onClick={() => onConfirm(note.trim())}>
            Mark 86'd
          </button>
        </div>
      </div>
    </div>
  );
}
