import { useState } from 'preact/hooks';
import { Pause, Play, Trash2, Clock } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiDelete } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

interface ScheduledTask {
  id: string;
  prompt: string;
  schedule: string;
  next_run: number;
  last_run: number | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'running';
  created_at: number;
  agent_id: string;
  started_at: number | null;
  last_status: 'success' | 'failed' | 'timeout' | null;
}

function describeCron(cron: string): string {
  // Best-effort human description for the most common patterns.
  if (cron === '0 9 * * *') return 'Daily at 9am';
  if (cron === '0 8 * * 1-5') return 'Every weekday at 8am';
  if (cron === '0 9 * * 1') return 'Every Monday at 9am';
  if (cron === '0 18 * * 0') return 'Every Sunday at 6pm';
  if (/^0 \*\/(\d+) \* \* \*$/.test(cron)) {
    const m = cron.match(/^0 \*\/(\d+) \* \* \*$/)!;
    return 'Every ' + m[1] + ' hour' + (m[1] === '1' ? '' : 's');
  }
  return cron;
}

function formatCountdown(unixSeconds: number): string {
  const diff = unixSeconds - Date.now() / 1000;
  if (diff < 0) return 'overdue';
  if (diff < 60) return 'in ' + Math.floor(diff) + 's';
  if (diff < 3600) return 'in ' + Math.floor(diff / 60) + 'm';
  if (diff < 86400) return 'in ' + Math.floor(diff / 3600) + 'h';
  return 'in ' + Math.floor(diff / 86400) + 'd';
}

export function Scheduled() {
  const { data, loading, error, refresh } = useFetch<{ tasks: ScheduledTask[] }>('/api/tasks', 30_000);
  const tasks = data?.tasks ?? [];

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Scheduled"
        actions={<span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{tasks.length} scheduled</span>}
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && tasks.length === 0 && (
        <PageState
          empty
          emptyTitle="No scheduled tasks"
          emptyDescription="Use mission-cli or ask the bot to create a recurring task. They'll show up here when they're scheduled."
        />
      )}

      {tasks.length > 0 && (
        <div class="flex-1 overflow-y-auto p-6">
          <div class="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {tasks.map((t) => <TaskRow key={t.id} task={t} onChange={refresh} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onChange }: { task: ScheduledTask; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);

  async function action(act: 'pause' | 'resume' | 'delete') {
    if (act === 'delete' && !confirm('Delete this scheduled task?')) return;
    setBusy(act);
    try {
      if (act === 'pause') await apiPost(`/api/tasks/${task.id}/pause`);
      if (act === 'resume') await apiPost(`/api/tasks/${task.id}/resume`);
      if (act === 'delete') await apiDelete(`/api/tasks/${task.id}`);
      onChange();
    } catch (err: any) { alert(act + ' failed: ' + (err?.message || err)); }
    finally { setBusy(null); }
  }

  const statusTone = task.status === 'running' ? 'running' : task.status === 'paused' ? 'cancelled' : 'done';

  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 hover:border-[var(--color-border-strong)] transition-colors">
      <div class="flex items-start gap-2 mb-2">
        <div class="flex-1 min-w-0">
          <div class="text-[12.5px] text-[var(--color-text)] line-clamp-2 leading-snug mb-1">
            {task.prompt}
          </div>
          <div class="flex items-center gap-2 text-[10.5px] text-[var(--color-text-faint)] flex-wrap">
            <span class="inline-flex items-center gap-1">
              <Clock size={10} />
              {describeCron(task.schedule)}
            </span>
            {task.status === 'active' && (
              <span class="text-[var(--color-accent)] tabular-nums">{formatCountdown(task.next_run)}</span>
            )}
            <Pill tone={statusTone}>{task.status}</Pill>
            {task.agent_id !== 'main' && <span class="font-mono">@{task.agent_id}</span>}
            {task.last_status && (
              <Pill tone={task.last_status === 'success' ? 'done' : task.last_status === 'timeout' ? 'medium' : 'failed'}>
                last: {task.last_status}
              </Pill>
            )}
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          {task.status === 'active' && (
            <button
              type="button"
              onClick={() => action('pause')}
              disabled={busy !== null}
              class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-40"
              title="Pause"
            >
              <Pause size={12} />
            </button>
          )}
          {task.status === 'paused' && (
            <button
              type="button"
              onClick={() => action('resume')}
              disabled={busy !== null}
              class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-40"
              title="Resume"
            >
              <Play size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => action('delete')}
            disabled={busy !== null}
            class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-40"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {task.last_result && (
        <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setShowResult((v) => !v)}
            class="text-[10.5px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
          >
            {showResult ? 'Hide' : 'Show'} last result · {formatRelativeTime(task.last_run || 0)}
          </button>
          {showResult && (
            <div class="mt-1.5 text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap font-mono leading-relaxed line-clamp-6">
              {task.last_result}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
