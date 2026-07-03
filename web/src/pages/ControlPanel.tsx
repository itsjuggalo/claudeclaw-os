import { useState } from 'preact/hooks';
import { NestedSquaresSpinner } from '../components/NestedSquaresSpinner';
import { SlidersHorizontal, RefreshCw, AlertTriangle, Zap, ShieldAlert, Server, RotateCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Toggle } from '@/components/Toggle';
import { useFetch } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';
import { apiPost } from '@/lib/api';
import { pushToast } from '@/lib/toasts';

type Kind = 'media' | 'trading' | 'service' | 'system';
type DangerWhen = 'on' | 'off' | 'always';

interface ControlRow {
  id: string;
  label: string;
  group: string;
  kind: Kind;
  type: 'toggle' | 'action';
  description: string;
  dangerWhen?: DangerWhen;
  dangerVerb?: string;
  actionLabel?: string;
  on: boolean;
  detail?: string;
}

interface Pending {
  row: ControlRow;
  desired: boolean; // for actions this is always true
}

// Status pill: meaning of `on` depends on kind. For trading toggles on=true means
// "trading enabled" (good/green); a tripped killswitch reads as halted (red).
function statusTone(row: ControlRow): { color: string; bg: string; text: string } {
  const green = { color: 'var(--color-status-done)', bg: 'color-mix(in srgb,var(--color-status-done) 16%,transparent)' };
  const red = { color: '#ef4444', bg: 'color-mix(in srgb,#ef4444 16%,transparent)' };
  const gray = { color: 'var(--color-text-faint)', bg: 'var(--color-elevated)' };
  if (row.id === 'halt-all') {
    return row.on ? { ...red, text: 'ALL HALTED' } : { ...gray, text: 'armed' };
  }
  if (row.kind === 'trading') {
    return row.on ? { ...green, text: 'TRADING' } : { ...red, text: 'HALTED' };
  }
  if (row.kind === 'service') {
    return row.on ? { ...green, text: 'ONLINE' } : { ...red, text: 'DOWN' };
  }
  // media / system
  return row.on ? { ...green, text: 'ON' } : { ...gray, text: 'OFF' };
}

export function ControlPanel() {
  const { data, loading, error, refresh } = useFetch<{ controls: ControlRow[] }>('/api/control/state', 5000);
  const { busy: refreshing, spin } = useSpin();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const controls = data?.controls ?? [];
  // Preserve registry order while grouping.
  const groups: string[] = [];
  for (const c of controls) if (!groups.includes(c.group)) groups.push(c.group);

  async function doApply(row: ControlRow, on: boolean, confirm = false) {
    setBusy(row.id);
    try {
      await apiPost(`/api/control/${row.id}`, { on, confirm });
      pushToast({ tone: 'success', title: `${row.label} — ${row.type === 'action' ? 'done' : on ? 'on' : 'off'}`, durationMs: 2400 });
      refresh();
    } catch (e) {
      pushToast({ tone: 'error', title: `${row.label} failed`, description: String((e as Error)?.message || e), durationMs: 6000 });
    } finally {
      setBusy(null);
      setPending(null);
    }
  }

  function requestToggle(row: ControlRow) {
    const desired = !row.on;
    const dir: DangerWhen = desired ? 'on' : 'off';
    const needConfirm = row.dangerWhen === 'always' || row.dangerWhen === dir;
    if (needConfirm) { setPending({ row, desired }); return; }
    void doApply(row, desired);
  }

  function requestAction(row: ControlRow) {
    if (row.dangerWhen) { setPending({ row, desired: true }); return; }
    void doApply(row, true);
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Control Panel"
        actions={
          <button type="button" onClick={() => void spin(refresh)} disabled={refreshing} aria-busy={refreshing} title="Refresh"
            class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {refreshing ? <NestedSquaresSpinner size={12} /> : <RefreshCw size={12} />} refresh
          </button>
        }
      />

      <div class="flex-1 overflow-y-auto px-3 md:px-5 py-4">
        <PageState loading={loading && controls.length === 0} error={error} />

        <p class="text-[12px] text-[var(--color-text-muted)] mb-4 max-w-prose">
          Flip operator switches from anywhere — no laptop needed. State is live (polls every 5s).
          Dangerous switches ask once before they fire.
        </p>

        {groups.map((group) => {
          const rows = controls.filter((c) => c.group === group);
          const isTrading = rows.some((r) => r.kind === 'trading');
          const isService = !isTrading && rows.some((r) => r.kind === 'service');
          return (
            <section
              key={group}
              class="mb-4 rounded-xl border bg-[var(--color-card)] overflow-hidden"
              style={isTrading
                ? 'border-color:color-mix(in srgb,#ef4444 45%,var(--color-border))'
                : 'border-color:var(--color-border)'}
            >
              <div class="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-elevated)]">
                {isTrading
                  ? <ShieldAlert size={14} class="text-[#ef4444]" />
                  : isService
                    ? <Server size={14} class="text-[var(--color-text-muted)]" />
                    : <SlidersHorizontal size={14} class="text-[var(--color-text-muted)]" />}
                <span class="text-[12px] font-semibold tracking-wide uppercase text-[var(--color-text-muted)]">{group}</span>
              </div>

              {rows.map((row) => {
                const tone = statusTone(row);
                const rowBusy = busy === row.id;
                return (
                  <div key={row.id} class="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)] last:border-0">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[14px] font-medium text-[var(--color-text)]">{row.label}</span>
                        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums"
                          style={`color:${tone.color};background:${tone.bg}`}>
                          {tone.text}
                        </span>
                        {row.detail && (
                          <span class="text-[10.5px] text-[var(--color-text-faint)]">{row.detail}</span>
                        )}
                      </div>
                      <div class="text-[11.5px] text-[var(--color-text-muted)] mt-0.5">{row.description}</div>
                    </div>

                    {row.type === 'toggle' ? (
                      <Toggle on={row.on} disabled={rowBusy} onChange={() => requestToggle(row)} ariaLabel={row.label} />
                    ) : row.kind === 'trading' ? (
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => requestAction(row)}
                        class="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold text-white disabled:opacity-50"
                        style="background:#ef4444"
                      >
                        <Zap size={13} /> {row.on ? 'Halted' : (row.actionLabel || 'Halt')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => requestAction(row)}
                        class="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold disabled:opacity-50 border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                      >
                        {rowBusy ? <NestedSquaresSpinner size={13} /> : <RotateCw size={13} />} {row.actionLabel || 'Run'}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}

        {controls.length > 0 && (
          <p class="text-[11px] text-[var(--color-text-faint)] mt-2 max-w-prose">
            Want more switches here (decision-cycle daemons, specific PM2 services, crons,
            ComfyUI gen-mode)? Ask and it's one registry entry in <code>src/controls.ts</code>.
          </p>
        )}
      </div>

      {/* Danger confirm — single tap to fire, tap-outside to cancel. */}
      {pending && (
        <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setPending(null)}>
          <div class="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} class="text-[#ef4444]" />
              <span class="text-[15px] font-semibold text-[var(--color-text)]">Confirm</span>
            </div>
            <p class="text-[13px] text-[var(--color-text-muted)] mb-4">
              {pending.row.dangerVerb || pending.row.label}? This affects live operations.
            </p>
            <div class="flex gap-2 justify-end">
              <button type="button" onClick={() => setPending(null)}
                class="px-3.5 py-2 rounded-md text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]">
                Cancel
              </button>
              <button type="button" disabled={busy === pending.row.id}
                onClick={() => void doApply(pending.row, pending.desired, true)}
                class="px-3.5 py-2 rounded-md text-[13px] font-semibold text-white disabled:opacity-50"
                style="background:#ef4444">
                {pending.row.dangerVerb || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
