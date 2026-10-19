// What was out, how often, for how long. The bars on top are the summary a
// manager shows the chef; the log underneath is the proof.
import { useEffect, useMemo, useState } from 'react';
import type { EightySixEvent } from '../types';
import { api } from '../api';
import { fmtDay, fmtDuration, fmtTime } from '../lib/format';

interface Props {
  restaurantId: string;
  refreshKey: number; // bumps after every change on the board
}

export function History({ restaurantId, refreshKey }: Props) {
  const [events, setEvents] = useState<EightySixEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    api
      .listHistory(restaurantId, 30)
      .then((list) => live && setEvents(list))
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [restaurantId, refreshKey]);

  const top = useMemo(() => {
    if (!events) return [];
    const now = Date.now();
    const agg = new Map<string, { name: string; count: number; ms: number }>();
    for (const e of events) {
      const ms = (e.endedAt ? Date.parse(e.endedAt) : now) - Date.parse(e.startedAt);
      const a = agg.get(e.itemId) ?? { name: e.itemName, count: 0, ms: 0 };
      a.count += 1;
      a.ms += ms;
      agg.set(e.itemId, a);
    }
    return [...agg.values()].sort((x, y) => y.ms - x.ms).slice(0, 5);
  }, [events]);

  const days = useMemo(() => {
    const map = new Map<string, EightySixEvent[]>();
    for (const e of events ?? []) {
      const day = fmtDay(e.startedAt);
      const list = map.get(day);
      if (list) list.push(e);
      else map.set(day, [e]);
    }
    return [...map.entries()];
  }, [events]);

  if (events === null) return <p className="muted">Loading history…</p>;

  const maxMs = top[0]?.ms ?? 1;

  return (
    <div className="history">
      <section aria-labelledby="top-heading">
        <h2 id="top-heading" className="display">
          Most time 86'd · last 30 days
        </h2>
        {top.length === 0 ? (
          <p className="muted">Nothing was 86'd in the last 30 days.</p>
        ) : (
          <ol className="bars">
            {top.map((t) => (
              <li key={t.name} className="bar-row">
                <div className="bar-label">
                  <span className="bar-name">{t.name}</span>
                  <span className="bar-val">
                    {t.count}× · {fmtDuration(t.ms)}
                  </span>
                </div>
                <div className="bar-track" aria-hidden="true">
                  <div className="bar-fill" style={{ width: `${Math.max(3, Math.round((t.ms / maxMs) * 100))}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="log-heading">
        <h2 id="log-heading" className="display">
          Log
        </h2>
        {days.map(([day, list]) => (
          <div key={day} className="day">
            <h3 className="day-h">{day}</h3>
            <ul className="log">
              {list.map((e) => {
                const end = e.endedAt ? Date.parse(e.endedAt) : Date.now();
                return (
                  <li key={e.id} className={'log-row' + (e.endedAt ? '' : ' is-open')}>
                    <div className="log-top">
                      <span className="log-name">{e.itemName}</span>
                      <span className="log-time">
                        {fmtTime(e.startedAt)} → {e.endedAt ? fmtTime(e.endedAt) : 'still out'} · {fmtDuration(end - Date.parse(e.startedAt))}
                      </span>
                    </div>
                    {e.note && <div className="log-note">“{e.note}”</div>}
                    <div className="log-by">
                      Marked by {e.markedBy}
                      {e.clearedBy ? ` · back on by ${e.clearedBy}` : ''}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
