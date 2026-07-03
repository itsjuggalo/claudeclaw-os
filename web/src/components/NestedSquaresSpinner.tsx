import { useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import type { JSX } from 'preact';

/**
 * Unified refresh spinner — the "nested squares" animation, shared across all
 * Mission Control sites. Preact port (missionctrl/ARIES have the identical React
 * one). Inline-sized by `size` px; keyframes live in styles/main.css (`.nsq-spinner`),
 * so this is markup-only — keep IDENTICAL across sites.
 */
export function NestedSquaresSpinner({ size = 14, class: cls = '', speed = 1 }: {
  size?: number; class?: string; speed?: number;
}) {
  return (
    <span
      class={`nsq-spinner ${cls}`}
      role="status"
      aria-label="Loading"
      style={{ fontSize: `${size}px`, '--nsq-speed': String(speed) } as JSX.CSSProperties}
    >
      <i /><i /><i /><i /><i />
    </span>
  );
}

/**
 * Drop-in refresh button: nested-squares spinner while `busy`, static RefreshCw
 * when idle. Manages its own busy state if `busy` isn't controlled from outside.
 */
export function RefreshButton({
  onClick, busy: controlledBusy, size = 13, class: cls = '', label = 'Refresh', title = 'Refresh',
}: {
  onClick: () => void | Promise<void>;
  busy?: boolean;
  size?: number;
  class?: string;
  label?: string;
  title?: string;
}) {
  const [innerBusy, setInnerBusy] = useState(false);
  const busy = controlledBusy ?? innerBusy;
  const handle = async () => {
    if (busy) return;
    if (controlledBusy === undefined) setInnerBusy(true);
    try { await onClick(); } finally { if (controlledBusy === undefined) setInnerBusy(false); }
  };
  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={busy}
      aria-busy={busy}
      title={title}
      class={`inline-flex items-center gap-1.5 ${cls}`}
    >
      {busy ? <NestedSquaresSpinner size={size} /> : <RefreshCw size={size} />}
      {label ? <span>{label}</span> : null}
    </button>
  );
}
