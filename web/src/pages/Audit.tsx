import { useState } from 'preact/hooks';
import { ShieldAlert, ShieldCheck } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { formatRelativeTime } from '@/lib/format';

interface AuditEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  detail: string;
  blocked: number;
  created_at: number;
}

export function Audit() {
  const [filter, setFilter] = useState<'all' | 'blocked'>('all');
  const path = filter === 'blocked' ? '/api/audit/blocked?limit=100' : '/api/audit?limit=100&offset=0';
  const { data, loading, error } = useFetch<{ entries: AuditEntry[]; total?: number }>(path, 60_000);
  const entries = data?.entries ?? [];
  const total = data?.total ?? entries.length;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Audit"
        actions={<span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{total} {filter === 'blocked' ? 'blocked' : 'entries'}</span>}
        tabs={
          <>
            <Tab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
            <Tab label="Blocked" active={filter === 'blocked'} onClick={() => setFilter('blocked')} />
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && entries.length === 0 && (
        <PageState empty emptyTitle="No audit events" emptyDescription="Security-relevant actions and kill-switch refusals appear here." />
      )}

      {entries.length > 0 && (
        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-[12px]">
            <thead class="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)]">
              <tr class="text-left">
                <th class="px-6 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[10%]">When</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[10%]">Agent</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[20%]">Action</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[8%] text-center">Status</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors">
                  <td class="px-6 py-2 text-[var(--color-text-faint)] tabular-nums whitespace-nowrap">
                    {formatRelativeTime(e.created_at)}
                  </td>
                  <td class="px-3 py-2 text-[var(--color-text-muted)]">{e.agent_id}</td>
                  <td class="px-3 py-2 font-mono text-[11px] text-[var(--color-text)]">{e.action}</td>
                  <td class="px-3 py-2 text-center">
                    {e.blocked === 1 ? (
                      <span class="inline-flex items-center gap-1 text-[var(--color-status-failed)] text-[10px] font-medium">
                        <ShieldAlert size={11} /> blocked
                      </span>
                    ) : (
                      <span class="inline-flex items-center gap-1 text-[var(--color-status-done)] text-[10px] font-medium">
                        <ShieldCheck size={11} /> ok
                      </span>
                    )}
                  </td>
                  <td class="px-3 py-2 text-[var(--color-text-muted)] truncate max-w-0 font-mono text-[11px]">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
