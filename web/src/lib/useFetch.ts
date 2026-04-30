import { useEffect, useState, useRef } from 'preact/hooks';
import { apiGet, ApiError } from './api';

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Tiny GET-with-polling hook. Re-fetches on `path` change and on a fixed
 * interval if `pollMs` is given. Aborts in-flight requests on unmount /
 * deps change.
 */
export function useFetch<T = unknown>(path: string | null, pollMs = 0): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastPath = useRef(path);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true);
    apiGet<T>(path).then((d) => {
      if (cancelled) return;
      setData(d);
      setError(null);
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof ApiError ? e.message : String(e));
    }).finally(() => {
      if (cancelled) return;
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [path, tick]);

  // Poll separately so the refresh tick is decoupled from path changes.
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  // Reset state when the path actually changes (not on poll).
  if (lastPath.current !== path) {
    lastPath.current = path;
    if (path === null) {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }

  return { data, loading, error, refresh: () => setTick((t) => t + 1) };
}
