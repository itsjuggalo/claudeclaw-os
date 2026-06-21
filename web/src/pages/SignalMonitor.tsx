import { Radio, RefreshCw, Activity, Send, BellRing, AlertTriangle } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { formatRelativeTime } from '@/lib/format';

interface Note {
  symbol: string; dir: 'bull' | 'bear' | 'neutral'; kind: string;
  value: number; text: string; extra: string; feed: string; received_at: string | null;
}
interface AppCol { id: string; label: string; sub: string; count: number; items: Note[]; }
interface Daemon {
  name: string; label: string; role: string; pm2: string; restarts: number;
  hbAge: number | null; alive: boolean;
  capturedToday?: number; capturedApprox?: boolean; lastCaptureAge?: number | null;
  caughtUp?: boolean; behindBytes?: number; lastPostAge?: number | null; lastPostLine?: string;
  pushesToday?: number; pushesTotal?: number; lastPushAge?: number | null;
}
interface Health { daemons: Daemon[]; forwarderState: string; capturedToday: number; capturedApprox: boolean; }
interface SignalMonitorData { generatedAt: number; apps: AppCol[]; health: Health; }

const ago = (iso: string | null) => (iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : '—');

// Compact age-in-seconds → "3s" / "4m" / "2h" / "3d".
function fmtAge(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '—';
  if (sec < 0) sec = 0;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const dirColor = (d: string) =>
  d === 'bull' ? 'var(--color-status-done)' : d === 'bear' ? 'var(--color-status-failed)' : 'var(--color-text-muted)';

const ROLE_ICON: Record<string, typeof Activity> = { capture: Activity, forward: Send, push: BellRing };

function DaemonChip({ d }: { d: Daemon }) {
  const Icon = ROLE_ICON[d.role] || Activity;
  const ok = d.alive;
  const color = ok ? 'var(--color-status-done)' : 'var(--color-status-failed)';
  // Role-specific one-liner = the "is it actually working" proof.
  let metric = '';
  if (d.role === 'capture') metric = `${d.capturedToday ?? 0}${d.capturedApprox ? '+' : ''} today · last ${fmtAge(d.lastCaptureAge)}`;
  else if (d.role === 'forward') metric = d.caughtUp ? `caught up · posted ${fmtAge(d.lastPostAge)} ago` : `behind ${(((d.behindBytes ?? 0) / 1024) | 0)}KB · posted ${fmtAge(d.lastPostAge)} ago`;
  else if (d.role === 'push') metric = `${d.pushesToday ?? 0} today · ${d.pushesTotal ?? 0} total`;

  return (
    <div class="flex-1 min-w-[220px] rounded-xl border bg-[var(--color-surface,var(--color-elevated))] px-3.5 py-3"
      style={`border-color:${ok ? 'color-mix(in srgb,var(--color-status-done) 35%,var(--color-border))' : 'color-mix(in srgb,var(--color-status-failed) 35%,var(--color-border))'}`}>
      <div class="flex items-center gap-2">
        <span class="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={`background:${color};box-shadow:0 0 8px ${color}`} />
        <Icon size={14} class="shrink-0" style={`color:${color}`} />
        <span class="text-[13px] font-semibold text-[var(--color-text)] truncate">{d.label}</span>
        <span class="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={`color:${color};background:color-mix(in srgb,${color} 14%,transparent)`}>
          {d.pm2}{d.restarts ? ` ·${d.restarts}r` : ''}
        </span>
      </div>
      <div class="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)] tabular-nums">
        <span title="heartbeat age">♥ {fmtAge(d.hbAge)}</span>
        <span class="text-[var(--color-text-faint)] truncate">{metric}</span>
      </div>
      <div class="mt-0.5 text-[10px] text-[var(--color-text-faint)] font-mono">{d.name}</div>
    </div>
  );
}

function NoteRow({ n }: { n: Note }) {
  const promo = n.kind === 'promo';
  return (
    <div class="border-b border-[var(--color-border)] last:border-0 px-3 py-2">
      <div class="flex items-baseline gap-2">
        {n.symbol
          ? <span class="text-[12px] font-bold tabular-nums shrink-0" style={`color:${dirColor(n.dir)}`}>{n.symbol}</span>
          : <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] shrink-0">{n.kind}</span>}
        <span class={`text-[11.5px] leading-snug ${promo ? 'italic text-[var(--color-text-faint)]' : 'text-[var(--color-text-muted)]'} line-clamp-2`}>{n.text}</span>
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums shrink-0" title={n.received_at || ''}>{ago(n.received_at)}</span>
      </div>
      {n.extra && <div class="mt-0.5 text-[10.5px] font-mono text-[var(--color-text-faint)] truncate">{n.extra}</div>}
    </div>
  );
}

function AppCard({ app }: { app: AppCol }) {
  return (
    <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] overflow-hidden flex flex-col">
      <div class="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="min-w-0">
          <div class="text-[13px] font-semibold text-[var(--color-text)] truncate">{app.label}</div>
          {app.sub && <div class="text-[10px] text-[var(--color-text-faint)] truncate">{app.sub}</div>}
        </div>
        <span class="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 text-[var(--color-text-muted)] bg-[var(--color-elevated)]">{app.count}</span>
      </div>
      <div class="max-h-[460px] overflow-y-auto">
        {app.items.length === 0
          ? <div class="px-3 py-6 text-center text-[11px] text-[var(--color-text-faint)]">no recent notifications<br /><span class="opacity-70">(quiet outside market hours)</span></div>
          : app.items.map((n, i) => <NoteRow key={i} n={n} />)}
      </div>
    </section>
  );
}

export function SignalMonitor() {
  const { data, loading, error, refresh } = useFetch<SignalMonitorData>('/api/signal-monitor', 8000);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Signal Monitor"
        actions={
          <button type="button" onClick={() => refresh()} title="Refresh"
            class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw size={12} /> refresh
          </button>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}

      {data && (
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <p class="text-[11px] text-[var(--color-text-faint)] leading-snug flex items-center gap-1.5">
            <Radio size={12} class="shrink-0" />
            Headless capture of the option/flow apps — proves the listeners are alive and forwarding to Discord (phone not needed).
            Auto-refreshes every 8s.
          </p>

          {/* Health strip — the "is it working + sending to Discord" answer at a glance */}
          <div class="flex flex-wrap gap-2.5">
            {data.health.daemons.map((d) => <DaemonChip key={d.name} d={d} />)}
          </div>
          {data.health.forwarderState && data.health.forwarderState !== 'unknown' && (
            <div class="text-[10.5px] text-[var(--color-text-faint)] flex items-center gap-1.5">
              {data.health.forwarderState !== 'ok' && <AlertTriangle size={11} style="color:var(--color-warn)" />}
              watchdog: <span class="font-mono">{data.health.forwarderState}</span>
              <span class="ml-2">captured today: <span class="font-mono">{data.health.capturedToday}{data.health.capturedApprox ? '+' : ''}</span></span>
            </div>
          )}

          {/* Side-by-side app columns */}
          <div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))">
            {data.apps.map((app) => <AppCard key={app.id} app={app} />)}
          </div>
        </div>
      )}
    </div>
  );
}
