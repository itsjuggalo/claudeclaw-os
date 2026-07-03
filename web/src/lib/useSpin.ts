import { useRef, useState } from 'preact/hooks';

/**
 * Guarantees a VISIBLE busy spin for any refresh/refetch control.
 *
 * `useFetch().refresh()` is fire-and-forget (returns void, and its `loading`
 * flag only flips on a true cold start), so binding a spinner to `loading`
 * shows nothing when the user manually refreshes cached data. `useSpin`
 * fixes that: it flips `busy` true, runs the refresh, then enforces a
 * MINIMUM visible spin (default 650ms) so the spinner is always seen —
 * even when the underlying refetch resolves instantly or off-thread.
 *
 * Pair with <NestedSquaresSpinner/> for the visual; set disabled/aria-busy
 * from `busy` on the control.
 */
export function useSpin(minMs = 650) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const spin = async (fn?: () => void | Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const started = Date.now();
    try {
      await fn?.();
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
      busyRef.current = false;
      setBusy(false);
    }
  };

  return { busy, spin };
}
