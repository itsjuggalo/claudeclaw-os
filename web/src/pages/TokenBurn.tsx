import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { NestedSquaresSpinner } from '@/components/NestedSquaresSpinner';
import { useFetch } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';
import { formatCost, formatNumber } from '@/lib/format';
import { showCosts } from '@/lib/theme';

interface TokenBurnData {
  generated: string;
  symbol: string;
  summary: { period: string; cost: number; apiCalls: number; sessions: number; projects: number }[];
  daily:   { date: string; cost: number; apiCalls: number; sessions: number }[];
  models:  { model: string; cost: number; share: number; oneShot: number }[];
  projects:{ project: string; cost: number; share: number; sessions: number; apiCalls: number }[];
  tools:   { tool: string; calls: number; share: number }[];
  activity:{ activity: string; cost: number; share: number }[];
}

export function TokenBurn() {
  const burn = useFetch<TokenBurnData>('/api/token-burn', 120_000);
  const { busy: refreshing, spin } = useSpin();
  const d = burn.data;

  const todayRow    = d?.summary.find((r) => r.period === 'Today');
  const sevenRow    = d?.summary.find((r) => r.period === '7 Days');
  const thirtyRow   = d?.summary.find((r) => r.period === '30 Days');

  const refreshBtn = (
    <button
      type="button"
      onClick={() => void spin(burn.refresh)}
      disabled={refreshing}
      aria-busy={refreshing}
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
    >
      {refreshing ? <NestedSquaresSpinner size={12} /> : null} Refresh
    </button>
  );

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Token Burn" actions={refreshBtn} />

      {burn.error && <PageState error={burn.error} />}
      {!burn.error && burn.loading && !d && <PageState loading />}

      {d && (
        <div class="flex-1 overflow-y-auto p-6 space-y-4">

          {/* as-of line */}
          <div class="text-[10px] text-[var(--color-text-faint)]">
            codeburn snapshot · {d.generated ? new Date(d.generated).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET' : '—'}
          </div>

          {/* KPI row */}
          <div class={(showCosts.value ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2') + ' grid gap-3'}>
            <KpiCard label="Today cost"     value={showCosts.value ? formatCost(todayRow?.cost ?? 0)  : '—'} />
            <KpiCard label="7-day cost"     value={showCosts.value ? formatCost(sevenRow?.cost ?? 0)  : '—'} />
            {showCosts.value && <KpiCard label="30-day cost"  value={formatCost(thirtyRow?.cost ?? 0)} />}
            <KpiCard label="30-day sessions" value={formatNumber(thirtyRow?.sessions ?? 0)} />
            <KpiCard label="30-day API calls" value={formatNumber(thirtyRow?.apiCalls ?? 0)} />
          </div>

          {/* 30-day daily cost sparkline */}
          {showCosts.value && (() => {
            const daily = d.daily;
            const totalCost = daily.reduce((a, b) => a + b.cost, 0);
            const hasData = daily.length > 1 && totalCost > 0;
            const dateRange = hasData
              ? `${daily[0]?.date} – ${daily[daily.length - 1]?.date}`
              : '';
            return (
              <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">30-day daily cost</div>
                  <div class="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                    {hasData ? `${formatCost(totalCost)} · ${dateRange}` : 'no data'}
                  </div>
                </div>
                {hasData
                  ? <DailyCostSparkline data={daily} />
                  : <div class="py-10 text-center text-[12px] text-[var(--color-text-muted)]">No daily cost data yet</div>}
              </div>
            );
          })()}

          {/* By model */}
          {d.models.length > 0 && (
            <Section title="By model (30 days)">
              <table class="w-full text-[12px]">
                <thead>
                  <tr class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    <th class="text-left pb-2">Model</th>
                    {showCosts.value && <th class="text-right pb-2">Cost</th>}
                    <th class="text-right pb-2">Share</th>
                    <th class="text-right pb-2">One-shot%</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--color-border)]">
                  {d.models.map((row) => (
                    <tr key={row.model} class="text-[var(--color-text-muted)]">
                      <td class="py-1.5 pr-4 text-[var(--color-text)]">{row.model}</td>
                      {showCosts.value && <td class="py-1.5 text-right tabular-nums">{formatCost(row.cost)}</td>}
                      <td class="py-1.5 text-right tabular-nums">{row.share.toFixed(1)}%</td>
                      <td class="py-1.5 text-right tabular-nums">{row.oneShot.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Top projects */}
          {d.projects.length > 0 && (
            <Section title="Top projects (30 days, top 12)">
              <table class="w-full text-[12px]">
                <thead>
                  <tr class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    <th class="text-left pb-2">Project</th>
                    {showCosts.value && <th class="text-right pb-2">Cost</th>}
                    <th class="text-right pb-2">Share</th>
                    <th class="text-right pb-2">Sessions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--color-border)]">
                  {d.projects.map((row) => (
                    <tr key={row.project} class="text-[var(--color-text-muted)]">
                      <td class="py-1.5 pr-4 font-mono text-[11px] text-[var(--color-text)]">{row.project}</td>
                      {showCosts.value && <td class="py-1.5 text-right tabular-nums">{formatCost(row.cost)}</td>}
                      <td class="py-1.5 text-right tabular-nums">{row.share.toFixed(1)}%</td>
                      <td class="py-1.5 text-right tabular-nums">{formatNumber(row.sessions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Top tools pills */}
          {d.tools.length > 0 && (
            <Section title="Top tools (30 days, top 10)">
              <div class="flex flex-wrap gap-2">
                {d.tools.map((row) => (
                  <div
                    key={row.tool}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-elevated)] border border-[var(--color-border)] text-[11px]"
                  >
                    <span class="text-[var(--color-text)]">{row.tool}</span>
                    <span class="text-[var(--color-text-faint)] tabular-nums">{formatNumber(row.calls)}</span>
                    <span class="text-[var(--color-text-faint)]">·</span>
                    <span class="text-[var(--color-text-muted)] tabular-nums">{row.share.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* By activity */}
          {d.activity.length > 0 && (
            <Section title="By activity (30 days)">
              <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                {d.activity.map((row) => (
                  <div key={row.activity} class="rounded-lg bg-[var(--color-elevated)] border border-[var(--color-border)] px-3 py-2">
                    <div class="text-[10px] text-[var(--color-text-faint)] truncate mb-1">{row.activity}</div>
                    <div class="flex items-baseline gap-2">
                      {showCosts.value && (
                        <span class="text-[13px] font-semibold tabular-nums text-[var(--color-text)]">{formatCost(row.cost)}</span>
                      )}
                      <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{row.share.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

        </div>
      )}
    </div>
  );
}

// ── Local sub-components ──────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">{label}</div>
      <div class="text-[20px] font-semibold tabular-nums text-[var(--color-text)]">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-3">{title}</div>
      {children}
    </div>
  );
}

function DailyCostSparkline({ data }: { data: { date: string; cost: number }[] }) {
  if (data.length < 2) {
    return <div class="text-[var(--color-text-faint)] text-[11px] py-8 text-center">Not enough data</div>;
  }
  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);
  const w = 100; const h = 24;
  const stepX = w / (data.length - 1);
  const points = data.map((d, i) => `${i * stepX},${h - (d.cost / maxCost) * h}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" class="w-full h-20">
        <polyline points={points} fill="none" stroke="var(--color-accent)" stroke-width="0.6" />
      </svg>
      <div class="flex justify-between mt-1 text-[10px] text-[var(--color-text-faint)] tabular-nums">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
