import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { formatRelativeTime } from '@/lib/format';

interface HiveEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  summary: string;
  artifacts: string | null;
  created_at: number;
}

const AGENT_HUE: Record<string, string> = {
  main: 'var(--color-accent)',
  research: '#5eb6ff',
  comms: '#10b981',
  content: '#f59e0b',
  ops: '#a78bfa',
};

export function HiveMind() {
  const { data, loading, error } = useFetch<{ entries: HiveEntry[] }>('/api/hive-mind?limit=100', 30_000);
  const entries = data?.entries ?? [];

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Hive Mind"
        actions={<span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{entries.length} entries</span>}
      />
      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && entries.length === 0 && (
        <PageState
          empty
          emptyTitle="No activity yet"
          emptyDescription="Every agent action — Telegram messages, delegated tasks, memory consolidations, kill-switch refusals — lands here as it happens."
        />
      )}

      {entries.length > 0 && (
        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-[12px]">
            <thead class="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)]">
              <tr class="text-left">
                <th class="px-6 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[12%]">When</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[12%]">Agent</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[14%]">Action</th>
                <th class="px-3 py-2 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Summary</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors">
                  <td class="px-6 py-2 text-[var(--color-text-faint)] tabular-nums whitespace-nowrap">
                    {formatRelativeTime(e.created_at)}
                  </td>
                  <td class="px-3 py-2">
                    <span
                      class="inline-flex items-center gap-1.5"
                      style={{ color: AGENT_HUE[e.agent_id] || 'var(--color-text-muted)' }}
                    >
                      <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />
                      {e.agent_id}
                    </span>
                  </td>
                  <td class="px-3 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                    {e.action}
                  </td>
                  <td class="px-3 py-2 text-[var(--color-text)] truncate max-w-0">
                    {e.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
