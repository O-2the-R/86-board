// The board itself: the 86'd tickets on top, the running-low tickets under
// them, the full menu by course below. Editors tap an item to 86 it or mark
// it running low; everyone else only reads.
import { useEffect, useMemo, useState } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { fmtDuration, fmtTime } from '../lib/format';

const QUICK_NOTES = ['Sold out', "Didn't come in", 'Vendor short', 'Quality, pulled', 'Back tomorrow'];
const COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

interface Props {
  items: MenuItem[];
  canEdit: boolean;
  actor: string; // name recorded on the change
  loading: boolean;
  onChanged: () => void; // ask for a fresh board right away
}

export function Board({ items, canEdit, actor, loading, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<MenuItem | null>(null); // item whose sheet is open
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const out = useMemo(
    () => items.filter((i) => i.status === 'out').sort((a, b) => (b.outSince ?? '').localeCompare(a.outSince ?? '')),
    [items],
  );
  const low = useMemo(
    () => items.filter((i) => i.status === 'low').sort((a, b) => (a.lowCount ?? 0) - (b.lowCount ?? 0) || (b.lowSince ?? '').localeCompare(a.lowSince ?? '')),
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

  function decide(d: Decision) {
    if (!target) return;
    const item = target;
    setTarget(null);
    if (d.kind === 'out') void run(item.id, () => api.markOut(item.id, d.note, actor));
    if (d.kind === 'low') void run(item.id, () => api.markLow(item.id, d.count, actor));
    if (d.kind === 'back') void back(item);
  }

  // on a paper ticket the button is ink; on the dark field it is sage
  const backButton = (it: MenuItem, label = 'Back on', tone: 'paper' | 'field' = 'paper') => (
    <button type="button" className={'btn btn-sm ' + (tone === 'paper' ? 'btn-paper' : 'btn-sage')} disabled={busyId === it.id} onClick={() => back(it)}>
      {label}
    </button>
  );

  const stateLabel = (it: MenuItem) =>
    it.status === 'out' ? (
      <em className="state state-out">86'd</em>
    ) : it.status === 'low' ? (
      <em className="state state-low">Last {it.lowCount ?? '?'}</em>
    ) : (
      <em className="state state-ok">Available</em>
    );

  return (
    <>
      {error && (
        <p className="error center" role="alert">
          {error}
        </p>
      )}

      <section className="sec" aria-labelledby="out-heading">
        <div className="sec-head">
          <h2 id="out-heading" className="sec-title">
            86'd now
          </h2>
          <span className="caption">{loading && items.length === 0 ? 'Loading' : `${out.length} ${out.length === 1 ? 'item' : 'items'}`}</span>
        </div>

        {!loading && out.length === 0 ? (
          <div className="allgood">
            <span className="allgood-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <div>
              <b>Nothing is 86'd</b>
              <span>The whole menu is on.</span>
            </div>
          </div>
        ) : (
          <ul className="tickets">
            {out.map((it) => (
              <li key={it.id} className="ticket">
                <div className="ticket-top">
                  <span className="stamp">86</span>
                  <span className="ticket-time num">
                    {it.outSince && (
                      <>
                        {fmtTime(it.outSince)}
                        <br />
                        {fmtDuration(now - Date.parse(it.outSince))}
                      </>
                    )}
                  </span>
                </div>
                <h3 className="ticket-name">{it.name}</h3>
                <div className="ticket-foot">
                  <p className="ticket-note">
                    {it.note ? `${it.note}. ` : ''}
                    {it.markedBy}
                  </p>
                  {canEdit && backButton(it)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(low.length > 0 || canEdit) && (
        <section className="sec" aria-labelledby="low-heading">
          <div className="sec-head">
            <h2 id="low-heading" className="sec-title">
              Running low
            </h2>
            <span className="caption">{low.length === 0 ? 'Nothing' : `${low.length} ${low.length === 1 ? 'item' : 'items'}`}</span>
          </div>
          {low.length === 0 ? (
            <p className="hint">When the kitchen is down to the last few of something, it shows up here with the count. Tap a menu item to mark it.</p>
          ) : (
            <ul className="tickets">
              {low.map((it) => (
                <li key={it.id} className="ticket ticket-low">
                  <div className="ticket-top">
                    <span className="stamp stamp-low">Last {it.lowCount ?? '?'}</span>
                    <span className="ticket-time num">
                      {it.lowSince && (
                        <>
                          {fmtTime(it.lowSince)}
                          <br />
                          {fmtDuration(now - Date.parse(it.lowSince))}
                        </>
                      )}
                    </span>
                  </div>
                  {canEdit ? (
                    <button type="button" className="ticket-tap" onClick={() => setTarget(it)}>
                      <h3 className="ticket-name">{it.name}</h3>
                      <span className="ticket-hint">Tap to change the count</span>
                    </button>
                  ) : (
                    <h3 className="ticket-name">{it.name}</h3>
                  )}
                  <div className="ticket-foot">
                    <p className="ticket-note">{it.markedBy}</p>
                    {canEdit && (
                      <span className="ticket-actions">
                        <button type="button" className="btn btn-sm btn-stamp" disabled={busyId === it.id} onClick={() => run(it.id, () => api.markOut(it.id, 'Sold out', actor))}>
                          86 it
                        </button>
                        {backButton(it, 'Plenty again')}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
        <p className="hint">{canEdit ? 'Tap an item to 86 it or mark it running low.' : 'Managers and kitchen update the board.'}</p>

        {courses.map(([course, list]) => (
          <div key={course} className="course">
            <h3 className="course-head">{course}</h3>
            <ul className="list">
              {list.map((it) => {
                const isOut = it.status === 'out';
                if (canEdit && !isOut) {
                  return (
                    <li key={it.id}>
                      <button type="button" className={'row' + (it.status === 'low' ? ' is-low' : '')} disabled={busyId === it.id} onClick={() => setTarget(it)}>
                        <span className="row-name">{it.name}</span>
                        {stateLabel(it)}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={it.id} className={'row' + (isOut ? ' is-out' : it.status === 'low' ? ' is-low' : '')}>
                    <span className="row-main">
                      <span className="row-name">{it.name}</span>
                      {isOut && it.outSince && <span className="row-meta">Out since {fmtTime(it.outSince)}</span>}
                    </span>
                    {isOut && canEdit ? backButton(it, 'Back on', 'field') : stateLabel(it)}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!loading && courses.length === 0 && <p className="hint center">No items match “{query}”.</p>}
      </section>

      {target && <ItemSheet item={target} onCancel={() => setTarget(null)} onDecide={decide} />}
    </>
  );
}

type Decision = { kind: 'out'; note: string } | { kind: 'low'; count: number } | { kind: 'back' };

// The sheet for an item that is not 86'd yet: mark it 86'd (with a note) or
// running low (with the count). Confirmation lives in the page because
// browser pop-ups are not available everywhere the app runs.
function ItemSheet({ item, onCancel, onDecide }: { item: MenuItem; onCancel: () => void; onDecide: (d: Decision) => void }) {
  const [mode, setMode] = useState<'out' | 'low'>(item.status === 'low' ? 'low' : 'out');
  const [note, setNote] = useState('');
  const [count, setCount] = useState<number>(item.lowCount ?? 4);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const chosen = custom.trim() ? Math.max(1, Math.round(Number(custom))) : count;
  const validCount = Number.isFinite(chosen) && chosen >= 1;

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-heading" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <h2 id="sheet-heading" className="sheet-title">
          {item.name}
        </h2>
        {item.status === 'low' && <p className="sheet-text center">Running low since {item.lowSince ? fmtTime(item.lowSince) : 'earlier'}, last {item.lowCount}.</p>}

        <div className="seg" role="tablist" aria-label="What is happening">
          <button type="button" role="tab" aria-selected={mode === 'out'} className={'seg-btn seg-out' + (mode === 'out' ? ' is-on' : '')} onClick={() => setMode('out')}>
            86 it
          </button>
          <button type="button" role="tab" aria-selected={mode === 'low'} className={'seg-btn seg-low' + (mode === 'low' ? ' is-on' : '')} onClick={() => setMode('low')}>
            Running low
          </button>
        </div>

        {mode === 'out' ? (
          <>
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
            <p className="hint center">Everyone sees it within five seconds.</p>
            <button type="button" className="btn btn-wide btn-stamp" onClick={() => onDecide({ kind: 'out', note: note.trim() })}>
              Mark 86'd
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <span className="field-label">How many left?</span>
              <div className="tags" role="group" aria-label="Portions left">
                {COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={'tag tag-count num' + (!custom.trim() && count === n ? ' is-on is-low' : '')}
                    aria-pressed={!custom.trim() && count === n}
                    onClick={() => {
                      setCount(n);
                      setCustom('');
                    }}
                  >
                    {n}
                  </button>
                ))}
                <input
                  id="sheet-count"
                  className="input input-count num"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  placeholder="Other"
                  aria-label="Another number"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </div>
            </div>
            <p className="hint center">Servers see “Last {validCount ? chosen : '…'}” next to the item.</p>
            <button type="button" className="btn btn-wide btn-amber" disabled={!validCount} onClick={() => onDecide({ kind: 'low', count: chosen })}>
              {item.status === 'low' ? `Update to last ${validCount ? chosen : '…'}` : `Mark running low, last ${validCount ? chosen : '…'}`}
            </button>
            {item.status === 'low' && (
              <button type="button" className="btn btn-wide btn-outline" onClick={() => onDecide({ kind: 'back' })}>
                Plenty again
              </button>
            )}
          </>
        )}

        <button type="button" className="btn btn-text btn-wide" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
