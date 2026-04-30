import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';
import { pushToast } from '@/lib/toasts';

interface Health {
  killSwitches: Record<string, boolean>;
  killSwitchRefusals: Record<string, number>;
  model: string;
  contextPct: number;
}

interface SecurityStatus { [key: string]: any; }

const KILL_SWITCH_LABELS: Record<string, { label: string; description: string }> = {
  WARROOM_TEXT_ENABLED: {
    label: 'Text War Room',
    description: 'Allow multi-agent text meetings via /api/warroom/text/*',
  },
  WARROOM_VOICE_ENABLED: {
    label: 'Voice War Room',
    description: 'Allow voice meetings via Pipecat',
  },
  LLM_SPAWN_ENABLED: {
    label: 'LLM spawn',
    description: 'Allow Claude SDK calls (master switch)',
  },
  DASHBOARD_MUTATIONS_ENABLED: {
    label: 'Dashboard mutations',
    description: 'Allow non-GET requests (set to false to lock dashboard read-only)',
  },
  MISSION_AUTO_ASSIGN_ENABLED: {
    label: 'Mission auto-assign',
    description: 'Allow Gemini classifier on /api/mission/tasks/auto-assign',
  },
  SCHEDULER_ENABLED: {
    label: 'Scheduler',
    description: 'Allow scheduled cron tasks to fire',
  },
};

export function Settings() {
  const health = useFetch<Health>('/api/health', 30_000);
  const security = useFetch<SecurityStatus>('/api/security/status', 60_000);

  const error = health.error || security.error;

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Settings" />

      {error && <PageState error={error} />}
      {(health.loading || security.loading) && !health.data && <PageState loading />}

      {health.data && (
        <div class="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
          <Section title="Kill switches" subtitle="Runtime feature gates. Toggling writes the flag to .env atomically; the runtime re-reads it within 1.5s so changes take effect without a restart.">
            <div class="space-y-2">
              {Object.entries(health.data.killSwitches).map(([key, on]) => {
                const meta = KILL_SWITCH_LABELS[key] || { label: key, description: '' };
                const refusals = health.data!.killSwitchRefusals[key] || 0;
                return (
                  <KillSwitchRow
                    key={key}
                    switchKey={key}
                    label={meta.label}
                    description={meta.description}
                    on={on}
                    refusals={refusals}
                    onChange={() => health.refresh()}
                  />
                );
              })}
            </div>
          </Section>

          <Section title="Read-only" subtitle="Settings that need an .env edit + restart to change.">
            <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
              <ReadOnlyRow label="Default model" value={health.data.model} />
              <ReadOnlyRow label="Context window" value={health.data.contextPct + '%'} />
              <div class="text-[10.5px] text-[var(--color-text-faint)] pt-2 border-t border-[var(--color-border)]">
                To toggle a kill switch, edit <code class="font-mono text-[var(--color-text-muted)]">.env</code> and set the relevant flag to <code class="font-mono text-[var(--color-text-muted)]">true</code> or <code class="font-mono text-[var(--color-text-muted)]">false</code>. The change takes effect within 1.5 seconds without a process restart.
              </div>
            </div>
          </Section>

          <Section title="Theme" subtitle="Use the workspace switcher in the sidebar to change theme.">
            <div class="text-[12px] text-[var(--color-text-muted)]">
              Three dark themes: Graphite (default), Midnight (blue), Crimson. Persisted to localStorage per browser.
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

interface KillSwitchRowProps {
  switchKey: string;
  label: string;
  description: string;
  on: boolean;
  refusals: number;
  onChange: () => void;
}

function KillSwitchRow({ switchKey, label, description, on, refusals, onChange }: KillSwitchRowProps) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const newValue = !on;
    if (!newValue && switchKey === 'DASHBOARD_MUTATIONS_ENABLED') {
      if (!confirm('Disabling dashboard mutations will lock this dashboard read-only. Every non-GET request will return 503 until you re-enable it (which means you cannot use this UI to turn it back on — you have to edit .env directly). Continue?')) {
        return;
      }
    }
    if (!newValue && switchKey === 'LLM_SPAWN_ENABLED') {
      if (!confirm('Disabling LLM_SPAWN_ENABLED will stop every Claude SDK call across all agents. Mission tasks, scheduled tasks, and agent replies will all stop firing. Continue?')) {
        return;
      }
    }
    setBusy(true);
    try {
      await apiPost('/api/security/kill-switch', { key: switchKey, enabled: newValue });
      pushToast({
        tone: newValue ? 'success' : 'warn',
        title: label + ' ' + (newValue ? 'enabled' : 'disabled'),
        description: 'Takes effect within 1.5s.',
      });
      // Wait a tick for the kill-switches re-read window so the next
      // refresh shows the new state.
      setTimeout(onChange, 1700);
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Toggle failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }
  return (
    <div class="flex items-start gap-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[12.5px] font-medium text-[var(--color-text)]">{label}</span>
          <code class="text-[10px] text-[var(--color-text-faint)] font-mono">{switchKey}</code>
        </div>
        <div class="text-[11px] text-[var(--color-text-muted)] leading-snug">{description}</div>
        {refusals > 0 && (
          <div class="text-[10.5px] text-[var(--color-status-failed)] mt-1 tabular-nums">
            {refusals} refusals since startup
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        class="relative shrink-0 inline-flex items-center w-9 h-5 rounded-full transition-colors disabled:opacity-40"
        style={{
          backgroundColor: on ? 'var(--color-status-done)' : 'var(--color-border-strong)',
        }}
        title={on ? 'Disable' : 'Enable'}
      >
        <span
          class="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
          style={{ transform: on ? 'translateX(20px)' : 'translateX(2px)' }}
        />
      </button>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div>
      <div class="mb-2">
        <h2 class="text-[13px] font-semibold text-[var(--color-text)]">{title}</h2>
        {subtitle && <p class="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between">
      <span class="text-[12px] text-[var(--color-text-muted)]">{label}</span>
      <span class="font-mono text-[11.5px] text-[var(--color-text)] tabular-nums">{value}</span>
    </div>
  );
}
