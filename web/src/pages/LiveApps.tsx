import { Smartphone, RefreshCw, Check, Loader2, Cpu, Container, Box, MonitorPlay } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

interface LiveAppsStatus {
  generatedAt: number;
  kernel: { binder: boolean; binderfs: boolean; dmabuf: boolean; ready: boolean };
  docker: { present: boolean; daemonUp: boolean; redroid: Array<{ name: string; status: string; ports: string }>; anyUp: boolean };
  wsScrcpy: { reachable: boolean; port: number; url: string };
  ready: boolean;
}

function StepRow({ icon: Icon, title, done, detail, cmd }: { icon: typeof Cpu; title: string; done: boolean; detail: string; cmd?: string }) {
  return (
    <div class="flex items-start gap-3 px-3.5 py-3 border-b border-[var(--color-border)] last:border-0">
      <span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0"
        style={done
          ? 'background:color-mix(in srgb,var(--color-status-done) 20%,transparent);color:var(--color-status-done)'
          : 'background:var(--color-elevated);color:var(--color-text-faint)'}>
        {done ? <Check size={12} /> : <Loader2 size={12} class="animate-spin" />}
      </span>
      <Icon size={15} class="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-[13px] font-medium text-[var(--color-text)]">{title}</span>
          <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={done
              ? 'color:var(--color-status-done);background:color-mix(in srgb,var(--color-status-done) 14%,transparent)'
              : 'color:var(--color-text-faint);background:var(--color-elevated)'}>
            {done ? 'ready' : 'pending'}
          </span>
        </div>
        <div class="text-[11px] text-[var(--color-text-muted)] mt-0.5">{detail}</div>
        {!done && cmd && (
          <code class="mt-1.5 block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-accent)] overflow-x-auto">{cmd}</code>
        )}
      </div>
    </div>
  );
}

export function LiveApps() {
  const { data, loading, error, refresh } = useFetch<LiveAppsStatus>('/api/live-apps/status', 5000);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Live Apps"
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
        <div class="flex-1 overflow-y-auto px-4 py-4">
          {data.ready ? (
            <div class="h-full flex flex-col">
              <p class="text-[11px] text-[var(--color-text-faint)] mb-2 flex items-center gap-1.5">
                <MonitorPlay size={12} /> Live app (redroid via ws-scrcpy) — tap and scroll the real app below.
              </p>
              <iframe
                src={data.wsScrcpy.url}
                class="flex-1 w-full rounded-xl border border-[var(--color-border)] bg-black min-h-[640px]"
                title="Live App"
                allow="clipboard-read; clipboard-write" />
            </div>
          ) : (
            <div class="max-w-[680px] mx-auto space-y-4">
              <p class="text-[11px] text-[var(--color-text-faint)] leading-snug flex items-center gap-1.5">
                <Smartphone size={12} class="shrink-0" />
                Run the signal apps' real Android UI in the dashboard (no phone) via redroid + ws-scrcpy.
                This needs a custom WSL2 kernel. Complete the steps below — the live app embeds here automatically once the stack is up.
              </p>

              <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] overflow-hidden">
                <StepRow icon={Cpu} title="1 · Custom WSL2 kernel"
                  done={data.kernel.ready}
                  detail={`binder ${data.kernel.binder ? '✓' : '✗'} · binderfs ${data.kernel.binderfs ? '✓' : '✗'} · dmabuf-heaps ${data.kernel.dmabuf ? '✓' : '✗'}. Build, then point .wslconfig at it + wsl --shutdown.`}
                  cmd="bash ~/restructure/redroid-kernel-build   # then .wslconfig kernel= + wsl --shutdown" />
                <StepRow icon={Container} title="2 · Docker in WSL"
                  done={data.docker.daemonUp}
                  detail={data.docker.present ? (data.docker.daemonUp ? 'daemon up' : 'installed, daemon not running') : 'not installed (run redroid-setup, or enable Docker Desktop WSL integration)'}
                  cmd="bash ~/restructure/redroid-setup   # installs docker + redroid + ws-scrcpy" />
                <StepRow icon={Box} title="3 · redroid container"
                  done={data.docker.anyUp}
                  detail={data.docker.anyUp
                    ? data.docker.redroid.map((r) => `${r.name} (${r.status})`).join(', ')
                    : 'no redroid container running yet — created by redroid-setup after the kernel reboot'}
                  cmd="adb -s localhost:5555 install <signal-app>.apk" />
                <StepRow icon={MonitorPlay} title="4 · ws-scrcpy-web"
                  done={data.wsScrcpy.reachable}
                  detail={`browser mirror+control on :${data.wsScrcpy.port} (${data.wsScrcpy.reachable ? 'reachable' : 'not reachable'}). Started by redroid-setup as PM2 'ws-scrcpy'.`} />
              </div>

              <p class="text-[10.5px] text-[var(--color-text-faint)] leading-snug">
                Order: build kernel → swap it in + <span class="font-mono">wsl --shutdown</span> (disruptive: kills PM2 + sessions) →
                <span class="font-mono"> redroid-setup</span> → install APKs. ws-scrcpy is bound to localhost (it exposes device control).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
