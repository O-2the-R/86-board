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

  if (events === null) return <p className="caption center">Loading the history…</p>;

  const maxMs = top[0]?.ms ?? 1;

  return (
    <>
      <section className="sec" aria-labelledby="top-heading">
        <div className="sec-head">
          <h2 id="top-heading" className="sec-title">
            Most time 86'd
          </h2>
          <span className="caption">Last 30 days</span>
        </div>
        {error && (
          <p className="error center" role="alert">
            {error}
          </p>
        )}
        <div className="panel">
          {top.length === 0 ? (
            <div className="empty">
              <b>Clean month</b>
              <span>Nothing was 86'd in the last 30 days.</span>
            </div>
          ) : (
            <ol className="bars">
              {top.map((t) => (
                <li key={t.name} className="bar-row">
                  <div className="bar-label">
                    <span className="bar-name">{t.name}</span>
                    <span className="bar-val">
                      {t.count} {t.count === 1 ? 'time' : 'times'}, {fmtDuration(t.ms)}
                    </span>
                  </div>
                  <div className="bar-track" aria-hidden="true">
                    <div className="bar-fill" style={{ width: `${Math.max(2, Math.round((t.ms / maxMs) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {days.length > 0 && (
        <section className="sec" aria-labelledby="log-heading">
          <div className="sec-head">
            <h2 id="log-heading" className="sec-title">
              Log
            </h2>
            <span className="caption">
              {events.length} {events.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          {days.map(([day, list]) => (
            <div key={day} className="course">
              <h3 className="course-head">{day}</h3>
              <ul className="list">
                  {list.map((e) => {
                    const end = e.endedAt ? Date.parse(e.endedAt) : Date.now();
                    return (
                      <li key={e.id} className={'row' + (e.endedAt ? '' : ' is-out')}>
                        <div className="row-main">
                          <span className="row-name">{e.itemName}</span>
                          {e.note && <span className="row-sub">{e.note}</span>}
                          <span className="row-meta">
                            {e.markedBy}
                            {e.clearedBy ? `, back on by ${e.clearedBy}` : ''}
                          </span>
                        </div>
                        <div className="row-side">
                          <span className="log-time">{e.endedAt ? `${fmtTime(e.startedAt)} – ${fmtTime(e.endedAt)}` : `Since ${fmtTime(e.startedAt)}`}</span>
                          <span className="row-meta">{e.endedAt ? fmtDuration(end - Date.parse(e.startedAt)) : 'Still out'}</span>
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
