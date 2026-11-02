// The line under the restaurant name. "Live" while the live connection is up
// or the last load was moments ago; amber with a clock after 10 seconds
// without either, red after 30. A stale board must never look live.
import { useEffect, useState } from 'react';

interface Props {
  lastOk: number | null; // when the board was last known to be current
  failing: boolean; // the most recent load failed
  live?: boolean; // the live connection is up: changes arrive as they happen
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

export function Freshness({ lastOk, failing, live = false }: Props) {
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

  // Connected and the last load worked: current by definition, no clock.
  const seconds = live && !failing ? 0 : Math.floor((Date.now() - lastOk) / 1000);
  const level = seconds > 30 ? 'bad' : seconds > 10 || failing ? 'warn' : 'ok';
  // Fresh is just "Live". The clock only starts when something is wrong.
  const text =
    level === 'bad'
      ? `Stale. Last update ${agoWords(seconds)}. Check the Wi-Fi.`
      : failing
        ? `Retrying. Last update ${agoWords(seconds)}.`
        : level === 'warn'
          ? `Last update ${agoWords(seconds)}`
          : 'Live';

  return (
    <span className={'fresh' + (level === 'bad' ? ' fresh-bad' : level === 'warn' ? ' fresh-warn' : '')} role="status">
      <span className="fresh-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
