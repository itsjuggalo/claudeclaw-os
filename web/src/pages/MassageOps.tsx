import { useEffect, useState } from 'preact/hooks';
import { HeartPulse, ShieldAlert, ShieldCheck, Trash2, RotateCcw, RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { NestedSquaresSpinner } from '@/components/NestedSquaresSpinner';
import { useFetch } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';
import { apiPost } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

interface LifecycleRow {
  id: string; email: string; name: string | null;
  state: 'warn' | 'warned' | 'delete' | 'reactivated';
  idle_days: number; warned_at: string | null; delete_at: string | null;
  days_until_delete: number | null; appt_count: number; future_appt_count: number;
}
interface Monitor {
  now: number;
  accounts: { total: number; verified: number; unverified: number; oauth_only: number; active_sessions: number;
    active: number; warn: number; warned: number; delete: number; reactivated: number; exempt: number };
  appointments: { requested: number; confirmed_upcoming: number; total: number };
  payments: { pending: number; claimed_sum: number; received_sum: number };
  membership_interest: number;
  reaper: { on: boolean; live: boolean; warn_days: number; grace_days: number;
    last_run: string | null; last_checked: number | null; last_warned: number | null; last_deleted: number | null };
  lifecycle: LifecycleRow[];
}

const agoFromIso = (iso: string | null) => (iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : '—');

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-3">
      <div class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      <div class="mt-1 text-[23px] font-semibold tabular-nums" style={tone ? `color:${tone}` : ''}>{value}</div>
    </div>
  );
}

function StatePill({ state }: { state: LifecycleRow['state'] }) {
  const map: Record<string, [string, string]> = {
    warn:        ['var(--color-warn)', 'stale'],
    warned:      ['var(--color-status-running)', 'warned'],
    delete:      ['var(--color-status-failed)', 'due now'],
    reactivated: ['var(--color-status-done)', 'came back'],
  };
  const [c, label] = map[state] || ['var(--color-text-muted)', state];
  return <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium" style={`color:${c};background:color-mix(in srgb, ${c} 14%, transparent)`}>{label}</span>;
}

export function MassageOps() {
  const { data, loading, error, refresh } = useFetch<Monitor>('/api/massage/monitor', 30000);
  const { busy: refreshing, spin } = useSpin();
  const [busy, setBusy] = useState<string | null>(null);
  const [actMsg, setActMsg] = useState<string | null>(null);
  // Local copy of the reaper knobs, seeded from the server each load.
  const [on, setOn] = useState(true);
  const [live, setLive] = useState(false);
  const [warnDays, setWarnDays] = useState(180);
  const [graceDays, setGraceDays] = useState(21);

  useEffect(() => {
    if (data?.reaper) {
      setOn(data.reaper.on); setLive(data.reaper.live);
      setWarnDays(data.reaper.warn_days); setGraceDays(data.reaper.grace_days);
    }
  }, [data?.reaper?.on, data?.reaper?.live, data?.reaper?.warn_days, data?.reaper?.grace_days]);

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setActMsg(null);
    try { await fn(); setActMsg(okMsg); refresh(); }
    catch (e: any) { setActMsg('⚠ ' + (e?.message || String(e))); }
    finally { setBusy(null); }
  }
  const applyReaper = () => act('reaper',
    () => apiPost('/api/massage/reaper', { on, live, warn_days: warnDays, grace_days: graceDays }),
    live ? `Reaper ARMED — ${warnDays}d warn / ${graceDays}d grace` : `Reaper saved (dry-run) — ${warnDays}d / ${graceDays}d`);
  const keep = (r: LifecycleRow) => act(r.id, () => apiPost(`/api/massage/account/${r.id}/keep`, {}), `Kept ${r.email}`);
  const del = (r: LifecycleRow) => {
    if (!window.confirm(`Delete account ${r.email}? Their booking history is kept as guest records. This cannot be undone.`)) return;
    return act(r.id, () => apiPost(`/api/massage/account/${r.id}/delete`, {}), `Deleted ${r.email}`);
  };

  const r = data?.reaper;
  const a = data?.accounts;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Massage Ops"
        actions={
          <button type="button" onClick={() => void spin(refresh)} disabled={refreshing} aria-busy={refreshing} title="Refresh"
            class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)] disabled:opacity-40">
            {refreshing ? <NestedSquaresSpinner size={12} /> : <RefreshCw size={12} />} refresh
          </button>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}

      {data && (
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {actMsg && (
            <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text-muted)]">{actMsg}</div>
          )}

          {/* Reaper status + controls */}
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2">
                <HeartPulse size={16} class="text-[var(--color-accent)]" />
                <h2 class="text-[14px] font-semibold">Stale-account reaper</h2>
                {r && (r.live
                  ? <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style="color:var(--color-status-failed);background:color-mix(in srgb,var(--color-status-failed) 14%,transparent)"><ShieldAlert size={11}/> LIVE — deletes</span>
                  : <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style="color:var(--color-status-done);background:color-mix(in srgb,var(--color-status-done) 14%,transparent)"><ShieldCheck size={11}/> dry-run</span>)}
                {r && !r.on && <span class="text-[11px] text-[var(--color-text-faint)]">(sweep off)</span>}
              </div>
              <div class="text-[12px] text-[var(--color-text-faint)] tabular-nums">
                last sweep {agoFromIso(r?.last_run ?? null)}
                {r?.last_run && <> · checked {r?.last_checked ?? 0}, warned {r?.last_warned ?? 0}, deleted {r?.last_deleted ?? 0}</>}
              </div>
            </div>

            <div class="mt-3 flex items-end gap-4 flex-wrap">
              <label class="flex flex-col gap-1 text-[12px] text-[var(--color-text-muted)]">
                Warn after (days idle)
                <input type="number" min={1} value={warnDays} onInput={(e) => setWarnDays(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
                  class="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[13px] text-[var(--color-text)] tabular-nums" />
              </label>
              <label class="flex flex-col gap-1 text-[12px] text-[var(--color-text-muted)]">
                Then delete after (grace days)
                <input type="number" min={0} value={graceDays} onInput={(e) => setGraceDays(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
                  class="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[13px] text-[var(--color-text)] tabular-nums" />
              </label>
              <label class="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)] pb-1.5">
                <input type="checkbox" checked={on} onChange={(e) => setOn((e.target as HTMLInputElement).checked)} /> sweep on
              </label>
              <label class="flex items-center gap-2 text-[13px] pb-1.5" style={live ? 'color:var(--color-status-failed)' : 'color:var(--color-text-muted)'}>
                <input type="checkbox" checked={live} onChange={(e) => setLive((e.target as HTMLInputElement).checked)} /> <strong>ARM (live delete)</strong>
              </label>
              <button type="button" onClick={applyReaper} disabled={busy === 'reaper'}
                class="ml-auto rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style="background:var(--color-accent)">
                {busy === 'reaper' ? 'Applying…' : 'Apply'}
              </button>
            </div>
            <p class="mt-2 text-[12px] text-[var(--color-text-faint)] leading-snug">
              Warned accounts get a one-time email with a “Keep my account” button; any login or booking resets the clock.
              Accounts with an upcoming appointment are never touched. Bookings survive deletion as guest records.
            </p>
          </section>

          {/* Account health */}
          <section class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat label="Total users" value={a?.total ?? 0} />
            <Stat label="Verified" value={a?.verified ?? 0} tone="var(--color-status-done)" />
            <Stat label="Unverified" value={a?.unverified ?? 0} tone={a && a.unverified ? 'var(--color-warn)' : undefined} />
            <Stat label="Active sessions" value={a?.active_sessions ?? 0} />
            <Stat label="OAuth-only" value={a?.oauth_only ?? 0} />
            <Stat label="Pending appts" value={data.appointments.requested} tone={data.appointments.requested ? 'var(--color-warn)' : undefined} />
            <Stat label="Upcoming appts" value={data.appointments.confirmed_upcoming} />
            <Stat label="Payments pending" value={data.payments.pending} tone={data.payments.pending ? 'var(--color-warn)' : undefined} />
            <Stat label="Membership interest" value={data.membership_interest} />
            <Stat label="Stale / warned / due" value={`${a?.warn ?? 0} / ${a?.warned ?? 0} / ${a?.delete ?? 0}`}
              tone={(a && (a.warned || a.delete)) ? 'var(--color-status-failed)' : undefined} />
          </section>

          {/* Lifecycle table */}
          <section>
            <h2 class="text-[14px] font-semibold text-[var(--color-text)] mb-2">
              Accounts needing attention {data.lifecycle.length > 0 && <span class="text-[var(--color-text-faint)]">({data.lifecycle.length})</span>}
            </h2>
            {data.lifecycle.length === 0 ? (
              <div class="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-[13px] text-[var(--color-text-faint)]">
                No stale or warned accounts — everyone's active or has an upcoming booking. ✅
              </div>
            ) : (
              <div class="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                <table class="w-full min-w-[640px] text-[13px]">
                  <thead class="sticky top-0 z-10 bg-[var(--color-elevated)] border-b border-[var(--color-border)] text-left">
                    <tr>
                      {['Account', 'State', 'Idle', 'Delete in', 'Bookings', ''].map((h, i) => (
                        <th key={i} class={'px-3 py-2.5 font-medium text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]' + (i === 3 ? ' text-center' : '')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.lifecycle.map((row) => {
                      const d = row.days_until_delete;
                      const danger = d != null && d <= 7;
                      return (
                        <tr key={row.id} class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-elevated)] transition-colors">
                          <td class="px-3 py-2.5">
                            <div class="text-[var(--color-text)]">{row.email}</div>
                            {row.name && <div class="text-[11px] text-[var(--color-text-faint)]">{row.name}</div>}
                          </td>
                          <td class="px-3 py-2.5"><StatePill state={row.state} /></td>
                          <td class="px-3 py-2.5 text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">{row.idle_days}d</td>
                          <td class="px-3 py-2.5 text-center tabular-nums whitespace-nowrap font-semibold"
                            style={d == null ? 'color:var(--color-text-faint)' : (danger ? 'color:var(--color-status-failed)' : 'color:var(--color-warn)')}>
                            {d == null ? '—' : (d === 0 ? 'now' : `${d}d`)}
                          </td>
                          <td class="px-3 py-2.5 text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                            {row.appt_count}{row.future_appt_count ? ` (${row.future_appt_count} upcoming)` : ''}
                          </td>
                          <td class="px-3 py-2.5 whitespace-nowrap text-right">
                            <button type="button" onClick={() => keep(row)} disabled={busy === row.id}
                              class="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-status-done)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
                              <RotateCcw size={12} /> Keep
                            </button>
                            <button type="button" onClick={() => del(row)} disabled={busy === row.id}
                              class="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
                              <Trash2 size={12} /> Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
