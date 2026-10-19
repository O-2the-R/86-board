// The line under the restaurant name. Olive when the board is fresh, amber
// after 10 seconds, oxblood after 30. A stale board must never look live.
import { useEffect, useState } from 'react';

interface Props {
  lastOk: number | null; // when the last good refresh happened
  failing: boolean; // the most recent refresh failed
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function agoWords(seconds: number): string {
  if (seconds < 2) return 'just now';
  if (seconds <= 10) return `${WORDS[seconds]} seconds ago`;
  if (seconds < 60) return `${seconds} seconds ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? 'an hour ago' : `${h} hours ago`;
}

export function Freshness({ lastOk, failing }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (lastOk === null) {
    return (
      <span className={'fresh' + (failing ? ' fresh-bad' : '')} role="status">
        <span className="fresh-dot" aria-hidden="true" />
        {failing ? 'No connection. Check the Wi-Fi.' : 'Connecting…'}
      </span>
    );
  }

  const seconds = Math.floor((Date.now() - lastOk) / 1000);
  const level = seconds > 30 ? 'bad' : seconds > 10 || failing ? 'warn' : 'ok';
  const text =
    level === 'bad'
      ? `Stale. Last update ${agoWords(seconds)}. Check the Wi-Fi.`
      : failing
        ? `Retrying. Last update ${agoWords(seconds)}.`
        : `Updated ${agoWords(seconds)}`;

  return (
    <span className={'fresh' + (level === 'bad' ? ' fresh-bad' : level === 'warn' ? ' fresh-warn' : '')} role="status">
      <span className="fresh-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
