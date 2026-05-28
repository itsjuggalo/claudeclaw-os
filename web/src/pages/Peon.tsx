import { useEffect, useState } from 'preact/hooks';
import { Smartphone, Bell, BellOff, Volume2, VolumeX, Send } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { apiGet, apiPost } from '@/lib/api';

interface PeonStatus {
  ok: boolean;
  paused: boolean;
  volume: number | null;
  mobileEnabled: boolean;
  ntfyTopic: string | null;
  telegramConfigured: boolean;
  error?: string;
}

interface PeonPack { name: string; label: string; active: boolean; }

export function Peon() {
  const [status, setStatus] = useState<PeonStatus | null>(null);
  const [packs, setPacks] = useState<PeonPack[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(0.8);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    try {
      const [s, p] = await Promise.all([
        apiGet<PeonStatus>('/api/peon/status'),
        apiGet<{ ok: boolean; packs: PeonPack[]; active: string | null }>('/api/peon/packs'),
      ]);
      if (s.ok) {
        setStatus(s);
        if (s.volume !== null) setVolume(s.volume);
      }
      if (p.ok) { setPacks(p.packs); setActivePack(p.active); }
    } catch { /* ignore */ }
  }

  useEffect(() => { void load(); }, []);

  async function toggleMute() {
    if (!status || busy) return;
    setBusy(true);
    try {
      if (status.paused) {
        await apiPost('/api/peon/resume', {});
        setStatus({ ...status, paused: false });
        showToast('Sounds resumed');
      } else {
        await apiPost('/api/peon/pause', {});
        setStatus({ ...status, paused: true });
        showToast('Sounds paused');
      }
    } finally { setBusy(false); }
  }

  async function toggleMobile() {
    if (!status || busy) return;
    setBusy(true);
    try {
      const enable = !status.mobileEnabled;
      await apiPost('/api/peon/mobile/toggle', { enable });
      setStatus({ ...status, mobileEnabled: enable });
      showToast(enable ? 'Mobile notifications on' : 'Mobile notifications off');
    } finally { setBusy(false); }
  }

  async function sendTestNotification() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost('/api/peon/mobile/test', {});
      showToast('Test notification sent');
    } catch { showToast('Failed to send test'); }
    finally { setBusy(false); }
  }

  async function commitVolume(val: number) {
    try {
      await apiPost('/api/peon/volume', { volume: val });
    } catch { /* ignore */ }
  }

  async function switchPack(name: string) {
    if (name === activePack || busy) return;
    setBusy(true);
    try {
      await apiPost('/api/peon/packs/use', { name });
      setActivePack(name);
      setPacks((prev) => prev.map((p) => ({ ...p, active: p.name === name })));
      showToast('Pack: ' + (packs.find((p) => p.name === name)?.label ?? name));
    } finally { setBusy(false); }
  }

  const paused = status?.paused ?? false;
  const mobileOn = status?.mobileEnabled ?? false;

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Peon Ping" />

      <div class="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">

        {/* Sound controls */}
        <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] divide-y divide-[var(--color-border)]">
          <div class="px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              {paused ? <VolumeX size={16} class="text-[var(--color-text-faint)]" /> : <Volume2 size={16} class="text-[var(--color-accent)]" />}
              <span class="text-[13px] font-medium text-[var(--color-text)]">Sound</span>
              <span class="text-[11px] text-[var(--color-text-faint)]">{paused ? 'muted' : 'active'}</span>
            </div>
            <button
              onClick={toggleMute}
              disabled={busy}
              class={[
                'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50',
                paused
                  ? 'bg-[var(--color-accent)] text-white hover:opacity-90'
                  : 'bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              ].join(' ')}
            >
              {paused ? 'Unmute' : 'Mute'}
            </button>
          </div>

          <div class="px-4 py-3 flex items-center gap-3">
            <span class="text-[12px] text-[var(--color-text-faint)] w-14 shrink-0">Volume</span>
            <input
              type="range" min="0" max="1" step="0.05"
              value={volume}
              onInput={(e) => setVolume(parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); setVolume(v); void commitVolume(v); }}
              class="flex-1 accent-[var(--color-accent)]"
            />
            <span class="text-[12px] text-[var(--color-text-faint)] w-8 text-right tabular-nums">{Math.round(volume * 100)}%</span>
          </div>

          <div class="px-4 py-3 flex items-center gap-3">
            <span class="text-[12px] text-[var(--color-text-faint)] w-14 shrink-0">Pack</span>
            <select
              value={activePack ?? ''}
              onChange={(e) => switchPack((e.target as HTMLSelectElement).value)}
              disabled={busy || packs.length === 0}
              class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50 cursor-pointer"
            >
              {packs.map((p) => (
                <option key={p.name} value={p.name}>{p.label}{p.active ? ' ✓' : ''}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Mobile notifications */}
        <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] divide-y divide-[var(--color-border)]">
          <div class="px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Smartphone size={16} class={mobileOn ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-faint)]'} />
              <span class="text-[13px] font-medium text-[var(--color-text)]">Mobile Notifications</span>
              <span class="text-[11px] text-[var(--color-text-faint)]">{mobileOn ? 'on' : 'off'}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={sendTestNotification}
                disabled={busy || !mobileOn}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                <Send size={11} />Test
              </button>
              <button
                onClick={toggleMobile}
                disabled={busy}
                class={[
                  'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50',
                  mobileOn
                    ? 'bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    : 'bg-[var(--color-accent)] text-white hover:opacity-90',
                ].join(' ')}
              >
                {mobileOn ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          {/* ntfy channel — always active via relay script */}
          <div class="px-4 py-3 flex items-center gap-3">
            <Bell size={14} class="text-[var(--color-accent)]" />
            <div class="flex-1 min-w-0">
              <div class="text-[12px] font-medium text-[var(--color-text)]">ntfy.sh</div>
              <div class="text-[11px] text-[var(--color-text-faint)] font-mono">topic: mike-peon-mc</div>
            </div>
            <a
              href="https://ntfy.sh/mike-peon-mc"
              target="_blank"
              rel="noopener noreferrer"
              class="text-[11px] text-[var(--color-accent)] hover:underline shrink-0"
            >
              Subscribe ↗
            </a>
          </div>

          {/* Telegram channel — always active via relay script */}
          <div class="px-4 py-3 flex items-center gap-3">
            <Bell size={14} class="text-[var(--color-accent)]" />
            <div class="flex-1 min-w-0">
              <div class="text-[12px] font-medium text-[var(--color-text)]">Telegram</div>
              <div class="text-[11px] text-[var(--color-text-faint)]">ClaudeClaw bot</div>
            </div>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">active</span>
          </div>
        </section>

        {/* ntfy phone setup steps — always shown */}
        <section class="rounded-lg border border-[var(--color-border)] px-4 py-3">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-3">ntfy phone setup</div>
          <ol class="space-y-2.5">
            <li class="flex items-start gap-3">
              <span class="text-[11px] font-semibold text-[var(--color-accent)] w-4 shrink-0 mt-0.5">1</span>
              <span class="text-[12.5px] text-[var(--color-text-muted)]">Install <span class="font-medium text-[var(--color-text)]">ntfy</span> from the App Store or Google Play</span>
            </li>
            <li class="flex items-start gap-3">
              <span class="text-[11px] font-semibold text-[var(--color-accent)] w-4 shrink-0 mt-0.5">2</span>
              <span class="text-[12.5px] text-[var(--color-text-muted)]">Open the app and tap the <span class="font-mono text-[11px] bg-[var(--color-elevated)] px-1.5 py-0.5 rounded">+</span> button</span>
            </li>
            <li class="flex items-start gap-3">
              <span class="text-[11px] font-semibold text-[var(--color-accent)] w-4 shrink-0 mt-0.5">3</span>
              <span class="text-[12.5px] text-[var(--color-text-muted)]">Enter topic: <span class="font-mono text-[11px] bg-[var(--color-elevated)] px-1.5 py-0.5 rounded text-[var(--color-accent)] select-all">mike-peon-mc</span> → Subscribe</span>
            </li>
            <li class="flex items-start gap-3">
              <span class="text-[11px] font-semibold text-[var(--color-accent)] w-4 shrink-0 mt-0.5">4</span>
              <span class="text-[12.5px] text-[var(--color-text-muted)]">Use the <span class="font-medium text-[var(--color-text)]">Test</span> button above to verify</span>
            </li>
          </ol>
        </section>

      </div>

      {toast && (
        <div class="fixed bottom-4 right-4 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-lg px-4 py-2.5 text-[13px] text-[var(--color-text)] shadow-lg z-50 animate-in">
          {toast}
        </div>
      )}
    </div>
  );
}
