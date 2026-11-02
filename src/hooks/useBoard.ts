// Keeps the board on screen current.
//
// On the real app the server pushes every change the moment it is saved (a
// live connection), so a 86 on one phone shows on every other phone within a
// second. While that connection is up, a full load every 30 seconds is only a
// safety net, and the check that the account is still switched on.
//
// Whenever the live connection is not up (starting, reconnecting, blocked by
// the Wi-Fi, or the sample mode, which has none), the board asks every 5
// seconds instead, as it always did. Coming back live, it loads once to catch
// up on anything said while it was away. It also loads when the phone wakes up
// or comes back online.
//
// The live feed has to keep earning its "Live". If a 30-second load brings
// back a change the feed never delivered, the board stops trusting it, goes
// back to every 5 seconds and starts the feed again 30 seconds later.
//
// The freshness line reads `live` and `lastOk` to know if the board can be
// trusted.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { SAMPLE_KEY } from '../api/mock';
import { applyChange, checkEveryMs, mergeLoaded, missedByFeed, noteDelivered, seenFrom, type FeedSeen, type LinkState } from '../lib/live';

interface Options {
  username: string;
  onRevoked: () => void; // a manager switched this account off
  onLiveChange?: () => void; // someone changed the board, here or on another phone
}

const RETRY_MS = 30_000; // after the live feed stops or misses a change, start it again this much later

export function useBoard(restaurantId: string, { username, onRevoked, onLiveChange }: Options) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<LinkState>('none');
  const [attempt, setAttempt] = useState(0); // bumps to start the live feed again
  const current = useRef(restaurantId);
  current.current = restaurantId;
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;
  const changed = useRef(onLiveChange);
  changed.current = onLiveChange;
  const linkNow = useRef(link);
  linkNow.current = link;
  // True once a load has finished while live: from then on, each load checks
  // the feed missed nothing.
  const vouched = useRef(false);
  const seen = useRef<FeedSeen>(new Map()); // what the feed has delivered since then
  const restartTimer = useRef<number | undefined>(undefined);

  const restartFeedLater = useCallback(() => {
    window.clearTimeout(restartTimer.current);
    restartTimer.current = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(restartTimer.current), []);

  const refresh = useCallback(async () => {
    const id = restaurantId;
    if (!id) {
      setLoading(false);
      return;
    }
    const started = Date.now();
    const checking = linkNow.current === 'live' && vouched.current;
    try {
      const [data, stillValid] = await Promise.all([api.listItems(id), api.accessStillValid(username)]);
      if (current.current !== id) return; // switched restaurants mid-request
      if (!stillValid) {
        revoked.current();
        return;
      }
      if (checking && linkNow.current === 'live' && missedByFeed(seen.current, data, started)) {
        vouched.current = false;
        setLink('down');
        restartFeedLater();
      } else if (linkNow.current === 'live' && !vouched.current) {
        vouched.current = true;
        for (const [itemId, at] of seenFrom(data)) if (at > (seen.current.get(itemId) ?? '')) seen.current.set(itemId, at);
      }
      setItems((prev) => mergeLoaded(prev, data));
      setLastOk(Date.now());
      setFailing(false);
    } catch {
      if (current.current === id) setFailing(true);
    } finally {
      if (current.current === id) setLoading(false);
    }
  }, [restaurantId, username, restartFeedLater]);

  // A new restaurant: start from nothing and load it.
  useEffect(() => {
    vouched.current = false;
    seen.current = new Map();
    setLoading(true);
    setItems([]);
    setLastOk(null);
    setFailing(false);
    void refresh();
  }, [refresh]);

  // The live feed for that restaurant.
  useEffect(() => {
    const id = restaurantId;
    if (!id) return;
    let retry: number | undefined;
    setLink('connecting');
    const stop = api.watchItems(id, {
      change: (c) => {
        if (current.current !== id) return;
        noteDelivered(seen.current, c);
        setItems((prev) => applyChange(prev, c, id));
        changed.current?.();
      },
      link: setLink,
      failed: () => {
        setLink('down');
        window.clearTimeout(retry);
        retry = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    });
    if (!stop) setLink('none');
    return () => {
      window.clearTimeout(retry);
      stop?.();
    };
  }, [restaurantId, attempt]);

  // Going live catches up once; dropping out of live keeps the board's age
  // honest (it was current until this moment).
  const wasLive = useRef(false);
  useEffect(() => {
    const isLive = link === 'live';
    if (isLive && !wasLive.current) void refresh();
    if (!isLive) {
      vouched.current = false;
      seen.current = new Map();
    }
    if (!isLive && wasLive.current) setLastOk((t) => (t === null ? t : Date.now()));
    wasLive.current = isLive;
  }, [link, refresh]);

  // Every 30 seconds while live, every 5 seconds otherwise; and on waking up.
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), checkEveryMs(link));
    const wake = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === SAMPLE_KEY) void refresh();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh, link]);

  return { items, lastOk, failing, loading, live: link === 'live', refresh };
}
