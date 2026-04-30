import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

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
          <Section title="Kill switches" subtitle="Runtime feature gates. Each one re-reads .env every 1.5s, so toggling in the file takes effect without a restart.">
            <div class="space-y-2">
              {Object.entries(health.data.killSwitches).map(([key, on]) => {
                const meta = KILL_SWITCH_LABELS[key] || { label: key, description: '' };
                const refusals = health.data!.killSwitchRefusals[key] || 0;
                return (
                  <div key={key} class="flex items-start gap-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-[12.5px] font-medium text-[var(--color-text)]">{meta.label}</span>
                        <code class="text-[10px] text-[var(--color-text-faint)] font-mono">{key}</code>
                      </div>
                      <div class="text-[11px] text-[var(--color-text-muted)] leading-snug">{meta.description}</div>
                      {refusals > 0 && (
                        <div class="text-[10.5px] text-[var(--color-status-failed)] mt-1 tabular-nums">
                          {refusals} refusals since startup
                        </div>
                      )}
                    </div>
                    <Pill tone={on ? 'done' : 'failed'}>{on ? 'on' : 'off'}</Pill>
                  </div>
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
