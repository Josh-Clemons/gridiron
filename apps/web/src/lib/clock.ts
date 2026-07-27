import { useEffect, useMemo, useState } from 'react';

/**
 * A clock that ticks in step with the server's.
 *
 * Locking is entirely a question of "is it past kickoff", and phones are routinely
 * minutes off. The board response carries the server's own `now`, so the offset
 * between the two clocks is measured when the board arrives and every lock decision on
 * the page is then made against server time.
 *
 * Everything reads this one source, which is also what makes locking testable: a test
 * renders with a fixed `serverNow` and gets deterministic lock state.
 */
export function useServerClock(serverNow: string | undefined, intervalMs = 1000): Date {
  const [tick, setTick] = useState(() => Date.now());

  const offsetMs = useMemo(() => {
    if (serverNow === undefined) return 0;
    const parsed = Date.parse(serverNow);
    return Number.isNaN(parsed) ? 0 : parsed - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const id = setInterval(() => {
      setTick(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);

  return new Date(tick + offsetMs);
}
