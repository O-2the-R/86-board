// The board itself: what is 86'd right now on top, the full menu below.
// Editors tap an item to 86 it (with an optional note) and tap "Back on"
// when it returns. Viewers only see the status.
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
  const now = Date.now();

  const out = useMemo(
    () => items.filter((i) => i.status === 'out').sort((a, b) => (b.outSince ?? '').localeCompare(a.outSince ?? '')),
    [items],
  );

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const it of items) {
      if (q && !it.name.toLowerCase().includes(q) && !it.category.toLowerCase().includes(q)) continue;
      const list = map.get(it.category);
      if (list) list.push(it);
      else map.set(it.category, [it]);
    }
    return [...map.entries()];
  }, [items, q]);

  async function back(item: MenuItem) {
    setBusyId(item.id);
    try {
      await api.markBack(item.id, actor);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmOut(note: string) {
    if (!target) return;
    const item = target;
    setTarget(null);
    setBusyId(item.id);
    try {
      await api.markOut(item.id, note, actor);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="board">
      <section aria-labelledby="out-heading">
        <div className="out-head">
          <h2 id="out-heading" className="display">
            86'd right now
          </h2>
          <span className="count" aria-label={`${out.length} items out`}>
            {out.length}
          </span>
        </div>

        {loading && items.length === 0 ? (
          <p className="muted">Loading the board…</p>
        ) : out.length === 0 ? (
          <p className="allgood">Nothing is 86'd. The whole menu is available.</p>
        ) : (
          <ul className="out-list">
            {out.map((it) => (
              <li key={it.id} className="out-card">
                <div className="out-main">
                  <div className="out-name">{it.name}</div>
                  <div className="out-meta">
                    <span>{it.category}</span>
                    {it.outSince && (
                      <span>
                        since {fmtTime(it.outSince)} · {fmtDuration(now - Date.parse(it.outSince))}
                      </span>
                    )}
                  </div>
                  {it.note && <div className="out-note">“{it.note}”</div>}
                  {it.markedBy && <div className="out-by">{it.markedBy}</div>}
                </div>
                {canEdit && (
                  <button type="button" className="btn btn-back" disabled={busyId === it.id} onClick={() => back(it)}>
                    Back on
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="menu-heading">
        <div className="menu-head">
          <h2 id="menu-heading" className="display">
            Full menu
          </h2>
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
        <p className="hint">
          {canEdit ? 'Tap an item to 86 it. Tap “Back on” when it is back.' : 'View only. Managers and kitchen update the board.'}
        </p>

        {groups.map(([category, list]) => (
          <div key={category} className="cat">
            <h3 className="cat-h">{category}</h3>
            <ul className="rows">
              {list.map((it) => {
                const isOut = it.status === 'out';
                return (
                  <li key={it.id} className={'row' + (isOut ? ' is-out' : '')}>
                    {canEdit && !isOut ? (
                      <button type="button" className="row-btn" disabled={busyId === it.id} onClick={() => setTarget(it)}>
                        <span className="row-name">{it.name}</span>
                        <span className="chip chip-ok">Available</span>
                      </button>
                    ) : (
                      <div className="row-static">
                        <span className="row-name">{it.name}</span>
                        {isOut ? (
                          canEdit ? (
                            <button type="button" className="btn btn-back btn-sm" disabled={busyId === it.id} onClick={() => back(it)}>
                              Back on
                            </button>
                          ) : (
                            <span className="chip chip-out">86'd</span>
                          )
                        ) : (
                          <span className="chip chip-ok">Available</span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!loading && groups.length === 0 && <p className="muted">No items match “{query}”.</p>}
      </section>

      {target && <OutSheet item={target} onCancel={() => setTarget(null)} onConfirm={confirmOut} />}
    </div>
  );
}

// The bottom sheet that confirms an 86. Confirmation lives in the page
// because browser pop-ups are not available inside the artifact viewer.
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
        <h2 id="sheet-heading" className="display">
          86 {item.name}?
        </h2>
        <p className="muted">Everyone sees it within 5 seconds.</p>
        <div className="quick">
          {QUICK_NOTES.map((n) => (
            <button
              key={n}
              type="button"
              className={'quick-btn' + (note === n ? ' is-on' : '')}
              onClick={() => setNote(note === n ? '' : n)}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          id="sheet-note"
          className="note-input"
          type="text"
          placeholder="Note (optional)"
          aria-label="Note"
          maxLength={80}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={() => onConfirm(note.trim())}>
            Mark 86'd
          </button>
        </div>
      </div>
    </div>
  );
}
