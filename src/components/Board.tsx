// The board itself: what is eighty-sixed on top, the full menu by course
// below. Editors tap an item to 86 it (with an optional note) and tap
// "Back on" when it returns. Everyone else only reads.
import { useEffect, useMemo, useState } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { fmtDuration, fmtTime } from '../lib/format';

const QUICK_NOTES = ['Sold out', "Didn't come in", 'Vendor short', 'Quality, pulled', 'Back tomorrow'];

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

  const backButton = (it: MenuItem) => (
    <button type="button" className="btn btn-sm btn-green" disabled={busyId === it.id} onClick={() => back(it)}>
      Back on
    </button>
  );

  return (
    <>
      <section className="sec" aria-labelledby="out-heading">
        <div className="sec-head">
          <h2 id="out-heading" className="sec-title">
            86'd now
            {out.length > 0 && <span className="badge">{out.length}</span>}
          </h2>
          <span className="caption">{loading && items.length === 0 ? 'Loading' : canEdit ? '' : 'View only'}</span>
        </div>

        {error && (
          <p className="error center" role="alert">
            {error}
          </p>
        )}

        <div className="card">
          {!loading && out.length === 0 ? (
            <div className="empty">
              <span className="empty-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <b>Everything is available</b>
              <span>Nothing is eighty-sixed right now.</span>
            </div>
          ) : (
            <ul>
              {out.map((it) => (
                <li key={it.id} className="row">
                  <div className="row-main">
                    <span className="row-title">{it.name}</span>
                    {it.note && <span className="row-sub">{it.note}</span>}
                    <span className="row-meta">
                      {it.outSince && `Since ${fmtTime(it.outSince)} · ${fmtDuration(now - Date.parse(it.outSince))}`}
                      {it.outSince && it.markedBy ? ' · ' : ''}
                      {it.markedBy}
                    </span>
                  </div>
                  {canEdit ? backButton(it) : <span className="chip chip-out">86'd</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="sec" aria-labelledby="menu-heading">
        <div className="sec-head">
          <h2 id="menu-heading" className="sec-title">
            Menu
          </h2>
          <span className="caption">{items.length ? `${items.length} items` : ''}</span>
        </div>

        <div className="search-wrap">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
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
        <p className="hint">{canEdit ? 'Tap an item to 86 it.' : 'Managers and kitchen update the board.'}</p>

        {courses.map(([course, list]) => (
          <div key={course} className="group">
            <h3 className="group-label caption-up">{course}</h3>
            <div className="card">
              <ul>
                {list.map((it) => {
                  const isOut = it.status === 'out';
                  const status = isOut ? <span className="chip chip-out">86'd</span> : <span className="chip chip-ok">Available</span>;
                  if (canEdit && !isOut) {
                    return (
                      <li key={it.id}>
                        <button type="button" className="row" disabled={busyId === it.id} onClick={() => setTarget(it)}>
                          <span className="row-title">{it.name}</span>
                          {status}
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={it.id} className={'row' + (isOut ? ' is-out' : '')}>
                      <div className="row-main">
                        <span className="row-title">{it.name}</span>
                        {isOut && it.outSince && <span className="row-meta">Out since {fmtTime(it.outSince)}</span>}
                      </div>
                      {isOut && canEdit ? backButton(it) : status}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
        {!loading && courses.length === 0 && (
          <div className="card">
            <div className="empty">
              <span>No items match “{query}”.</span>
            </div>
          </div>
        )}
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
        <div className="grabber" aria-hidden="true" />
        <h2 id="sheet-heading" className="sheet-title">
          86 {item.name}?
        </h2>
        <p className="hint center">Everyone sees it within five seconds.</p>
        <div className="tags" role="group" aria-label="Quick note">
          {QUICK_NOTES.map((n) => (
            <button key={n} type="button" className={'tag' + (note === n ? ' is-on' : '')} aria-pressed={note === n} onClick={() => setNote(note === n ? '' : n)}>
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
        <button type="button" className="btn btn-red btn-wide" onClick={() => onConfirm(note.trim())}>
          Mark 86'd
        </button>
        <button type="button" className="btn btn-text btn-wide" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
