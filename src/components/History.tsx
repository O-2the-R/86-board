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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .listHistory(restaurantId, 30)
      .then((list) => live && setEvents(list))
      .catch((e: unknown) => {
        if (!live) return;
        setEvents([]);
        setError(e instanceof Error ? e.message : 'Could not load the history.');
      });
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

  if (events === null) return <p className="hint center">Loading the history…</p>;

  const maxMs = top[0]?.ms ?? 1;

  return (
    <>
      <section className="sec" aria-labelledby="top-heading">
        <h2 id="top-heading" className="sec-head">
          Most time eighty-sixed
        </h2>
        <div className="sec-sub caps-sm">Last thirty days</div>
        {error && (
          <p className="error center" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
        {top.length === 0 ? (
          <p className="allgood">Nothing was eighty-sixed in the last thirty days.</p>
        ) : (
          <ol className="bars">
            {top.map((t) => (
              <li key={t.name} className="bar-row">
                <div className="bar-label">
                  <span className="bar-name">{t.name}</span>
                  <span className="bar-val">
                    {t.count} {t.count === 1 ? 'time' : 'times'} · {fmtDuration(t.ms)}
                  </span>
                </div>
                <div className="bar-track" aria-hidden="true">
                  <div className="bar-fill" style={{ width: `${Math.max(2, Math.round((t.ms / maxMs) * 100))}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {days.length > 0 && (
        <section className="sec" aria-labelledby="log-heading">
          <h2 id="log-heading" className="sr-only">
            Log
          </h2>
          {days.map(([day, list]) => (
            <div key={day} className="day">
              <h3 className="course-head display-caps">{day}</h3>
              <ul>
                {list.map((e) => {
                  const end = e.endedAt ? Date.parse(e.endedAt) : Date.now();
                  return (
                    <li key={e.id} className={'log-row' + (e.endedAt ? '' : ' is-open')}>
                      <div className="log-top">
                        <span className="log-name">{e.itemName}</span>
                        <span className="log-time">
                          {fmtTime(e.startedAt)} to {e.endedAt ? fmtTime(e.endedAt) : 'now'} · {fmtDuration(end - Date.parse(e.startedAt))}
                        </span>
                      </div>
                      {e.note && <div className="log-note">{e.note}</div>}
                      <div className="log-by">
                        Marked by {e.markedBy}
                        {e.clearedBy ? `, back on by ${e.clearedBy}` : ''}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
