// The 5-second heartbeat. Asks the data drawer for the board, remembers when
// the last good answer arrived, and tries again whenever the phone wakes up
// or comes back online. The freshness line reads lastOk to know if the board
// can be trusted. Every beat also checks the account is still switched on.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { SAMPLE_KEY } from '../api/mock';

interface Options {
  username: string;
  onRevoked: () => void; // a manager switched this account off
  intervalMs?: number;
}

export function useBoard(restaurantId: string, { username, onRevoked, intervalMs = 5000 }: Options) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  const [loading, setLoading] = useState(true);
  const current = useRef(restaurantId);
  current.current = restaurantId;
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  const refresh = useCallback(async () => {
    const id = restaurantId;
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const [data, stillValid] = await Promise.all([api.listItems(id), api.accessStillValid(username)]);
      if (current.current !== id) return; // switched restaurants mid-request
      if (!stillValid) {
        revoked.current();
        return;
      }
      setItems(data);
      setLastOk(Date.now());
      setFailing(false);
    } catch {
      if (current.current === id) setFailing(true);
    } finally {
      if (current.current === id) setLoading(false);
    }
  }, [restaurantId, username]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    setLastOk(null);
    setFailing(false);
    void refresh();

    const timer = window.setInterval(() => void refresh(), intervalMs);
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
  }, [refresh, intervalMs]);

  return { items, lastOk, failing, loading, refresh };
}
