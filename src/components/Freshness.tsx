// The pill in the header. Green when the board is fresh, amber after 10
// seconds, red after 30. A stale board must never look live.
import { useEffect, useState } from 'react';
import { fmtAgo } from '../lib/format';

interface Props {
  lastOk: number | null; // when the last good refresh happened
  failing: boolean; // the most recent refresh failed
}

export function Freshness({ lastOk, failing }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (lastOk === null) {
    return <span className={'pill ' + (failing ? 'pill-bad' : 'pill-wait')}>{failing ? 'No connection' : 'Connecting…'}</span>;
  }

  const seconds = Math.floor((Date.now() - lastOk) / 1000);
  const level = seconds > 30 ? 'bad' : seconds > 10 || failing ? 'warn' : 'ok';
  const text =
    level === 'bad' ? `Stale · ${fmtAgo(seconds)} · check Wi-Fi` : failing ? `Retrying · ${fmtAgo(seconds)}` : `Updated ${fmtAgo(seconds)}`;

  return <span className={`pill pill-${level}`}>{text}</span>;
}
