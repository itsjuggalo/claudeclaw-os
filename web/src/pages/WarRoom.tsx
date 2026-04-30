import { useState } from 'preact/hooks';
import { Mic, MessageSquare, Video, ExternalLink, Pin, PinOff } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Pill } from '@/components/Pill';
import { useFetch } from '@/lib/useFetch';
import { apiPost, dashboardToken, chatId } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

type Mode = 'picker' | 'voice' | 'text' | 'meet';

interface PinState { ok: boolean; agent: string | null; mode: 'direct' | 'auto'; }
interface RosterAgent { id: string; name: string; description: string; }
interface TextMeetingSummary { id: string; started_at: number; ended_at: number | null; entry_count: number; preview: string; }
interface VoiceMeeting { id: string; started_at: number; ended_at: number | null; duration_s: number | null; mode: string; pinned_agent: string; entry_count: number; }
interface MeetSession { id: string; agent_id: string; provider: string; status: string; meet_url: string; created_at: number; }

export function WarRoom() {
  const [mode, setMode] = useState<Mode>('picker');

  if (mode === 'picker') {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="War Room" />
        <div class="flex-1 overflow-y-auto p-8">
          <div class="max-w-3xl mx-auto">
            <p class="text-[12.5px] text-[var(--color-text-muted)] mb-6 leading-relaxed">
              Pull all agents into one conversation. Voice rooms speak in real-time via Pipecat + Gemini Live.
              Text rooms work async with full transcript and per-agent pinning.
            </p>
            <div class="grid grid-cols-2 gap-4">
              <ModeCard
                icon={<Mic size={20} />}
                title="Voice"
                description="Live voice meeting with all agents in the same Gemini Live session. Pin one agent for direct mode, or use auto-routing."
                onClick={() => setMode('voice')}
              />
              <ModeCard
                icon={<MessageSquare size={20} />}
                title="Text"
                description="Threaded text meeting with full transcript, agent intervener routing, and SSE streaming. Async-friendly."
                onClick={() => setMode('text')}
              />
              <ModeCard
                icon={<Video size={20} />}
                title="Live Meetings"
                description="Send an agent into a Google Meet via Pika, or create a Daily.co room. Active sessions and history."
                onClick={() => setMode('meet')}
              />
              <ExternalCard
                icon={<ExternalLink size={20} />}
                title="Open in classic"
                description="Voice and text War Room pages from the legacy dashboard, served by the same backend."
                href={`/warroom?token=${encodeURIComponent(dashboardToken)}&chatId=${encodeURIComponent(chatId)}`}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="War Room"
        breadcrumb="War Room"
        tabs={
          <>
            <Tab label="Voice" active={mode === 'voice'} onClick={() => setMode('voice')} />
            <Tab label="Text" active={mode === 'text'} onClick={() => setMode('text')} />
            <Tab label="Live Meetings" active={mode === 'meet'} onClick={() => setMode('meet')} />
            <button
              type="button"
              onClick={() => setMode('picker')}
              class="ml-auto text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
            >
              ← Back to picker
            </button>
          </>
        }
      />
      <div class="flex-1 overflow-y-auto">
        {mode === 'voice' && <VoicePane />}
        {mode === 'text' && <TextPane />}
        {mode === 'meet' && <MeetPane />}
      </div>
    </div>
  );
}

function ModeCard({ icon, title, description, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      class="text-left bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] rounded-lg p-5 transition-colors"
    >
      <div class="text-[var(--color-accent)] mb-3">{icon}</div>
      <div class="text-[15px] font-semibold text-[var(--color-text)] mb-1">{title}</div>
      <div class="text-[12px] text-[var(--color-text-muted)] leading-relaxed">{description}</div>
    </button>
  );
}

function ExternalCard({ icon, title, description, href }: any) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      class="block text-left bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-text-muted)] rounded-lg p-5 transition-colors"
    >
      <div class="text-[var(--color-text-muted)] mb-3">{icon}</div>
      <div class="text-[15px] font-semibold text-[var(--color-text)] mb-1">{title}</div>
      <div class="text-[12px] text-[var(--color-text-muted)] leading-relaxed">{description}</div>
    </a>
  );
}

// ── Voice pane ─────────────────────────────────────────────────────

function VoicePane() {
  const pin = useFetch<PinState>('/api/warroom/pin', 5_000);
  const roster = useFetch<{ agents: RosterAgent[] }>('/api/warroom/agents', 60_000);
  const meetings = useFetch<{ meetings: VoiceMeeting[] }>('/api/warroom/meetings?limit=10', 60_000);
  const [busy, setBusy] = useState<string | null>(null);

  async function setPin(agent: string | null, mode: 'direct' | 'auto' = 'direct') {
    setBusy('pin');
    try {
      if (agent === null) await apiPost('/api/warroom/unpin');
      else await apiPost('/api/warroom/pin', { agent, mode });
      pin.refresh();
    } catch (err: any) { alert('Pin failed: ' + (err?.message || err)); }
    finally { setBusy(null); }
  }

  return (
    <div class="p-6 space-y-5">
      <section>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Pin an agent</div>
        <div class="text-[11.5px] text-[var(--color-text-muted)] mb-3 leading-relaxed">
          Direct mode routes every voice utterance to the pinned agent. Auto mode keeps the router on but uses the pin as the default route.
        </div>
        <div class="flex flex-wrap gap-1.5">
          <PinButton
            agent={null} label="Unpin" active={!pin.data?.agent}
            onClick={() => setPin(null)} disabled={busy === 'pin'}
          />
          {(roster.data?.agents ?? []).map((a) => (
            <PinButton
              key={a.id} agent={a} label={a.name || a.id}
              active={pin.data?.agent === a.id}
              onClick={() => setPin(a.id, pin.data?.mode || 'direct')}
              disabled={busy === 'pin'}
            />
          ))}
        </div>
        {pin.data?.agent && (
          <div class="mt-3 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>Mode:</span>
            <button
              type="button"
              onClick={() => setPin(pin.data!.agent!, 'direct')}
              class={[
                'px-2 py-0.5 rounded text-[10px] uppercase tracking-wider',
                pin.data.mode === 'direct' ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]',
              ].join(' ')}
            >
              Direct
            </button>
            <button
              type="button"
              onClick={() => setPin(pin.data!.agent!, 'auto')}
              class={[
                'px-2 py-0.5 rounded text-[10px] uppercase tracking-wider',
                pin.data.mode === 'auto' ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]',
              ].join(' ')}
            >
              Auto
            </button>
          </div>
        )}
      </section>

      <section>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Open the voice room</div>
        <a
          href={`/warroom?mode=voice&token=${encodeURIComponent(dashboardToken)}&chatId=${encodeURIComponent(chatId)}`}
          target="_blank"
          rel="noreferrer"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Mic size={13} /> Launch voice meeting
        </a>
      </section>

      <section>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Recent voice meetings</div>
        {meetings.loading && <div class="text-[11px] text-[var(--color-text-faint)]">Loading…</div>}
        {!meetings.loading && (meetings.data?.meetings ?? []).length === 0 && (
          <div class="text-[11px] text-[var(--color-text-faint)]">None yet</div>
        )}
        <div class="space-y-1">
          {(meetings.data?.meetings ?? []).map((m) => (
            <div key={m.id} class="flex items-center gap-3 px-3 py-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[11.5px]">
              <span class="text-[var(--color-text-muted)] tabular-nums">{formatRelativeTime(m.started_at)}</span>
              <span class="text-[var(--color-text-faint)]">·</span>
              <span class="text-[var(--color-text-muted)]">{m.mode}</span>
              {m.pinned_agent && (<><span class="text-[var(--color-text-faint)]">·</span><span class="text-[var(--color-text)]">@{m.pinned_agent}</span></>)}
              <span class="text-[var(--color-text-faint)]">·</span>
              <span class="text-[var(--color-text-muted)] tabular-nums">{m.entry_count} turns</span>
              {m.duration_s !== null && (<><span class="text-[var(--color-text-faint)]">·</span><span class="text-[var(--color-text-muted)] tabular-nums">{Math.round(m.duration_s / 60)}m</span></>)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PinButton({ agent, label, active, onClick, disabled }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      class={[
        'inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] border transition-colors disabled:opacity-40',
        active
          ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
      ].join(' ')}
    >
      {agent && <AgentAvatar agentId={agent.id} size={18} running />}
      {!agent && <PinOff size={13} />}
      {label}
      {active && <Pin size={11} />}
    </button>
  );
}

// ── Text pane ──────────────────────────────────────────────────────

function TextPane() {
  const meetings = useFetch<{ meetings: TextMeetingSummary[] }>(`/api/warroom/text/list?chatId=${encodeURIComponent(chatId)}&limit=20`, 30_000);
  const [creating, setCreating] = useState(false);

  async function newMeeting() {
    setCreating(true);
    try {
      const res = await apiPost<{ ok: boolean; meetingId: string }>('/api/warroom/text/new', { chatId });
      // Open in same window — text war room is served by legacy backend at /warroom/text.
      window.location.href = `/warroom/text?token=${encodeURIComponent(dashboardToken)}&meetingId=${encodeURIComponent(res.meetingId)}&chatId=${encodeURIComponent(chatId)}`;
    } catch (err: any) {
      alert('New meeting failed: ' + (err?.message || err));
    } finally { setCreating(false); }
  }

  const list = meetings.data?.meetings ?? [];

  return (
    <div class="p-6 space-y-4">
      <button
        type="button"
        onClick={newMeeting}
        disabled={creating}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
      >
        <MessageSquare size={13} /> {creating ? 'Creating…' : 'New text meeting'}
      </button>

      <section>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Recent text meetings</div>
        {meetings.loading && <PageState loading />}
        {!meetings.loading && list.length === 0 && (
          <div class="text-[11.5px] text-[var(--color-text-faint)]">None yet — start a new one above.</div>
        )}
        <div class="space-y-1.5">
          {list.map((m) => (
            <a
              key={m.id}
              href={`/warroom/text?token=${encodeURIComponent(dashboardToken)}&meetingId=${encodeURIComponent(m.id)}&chatId=${encodeURIComponent(chatId)}`}
              class="block bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-lg p-3 transition-colors"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="font-mono text-[10px] text-[var(--color-text-faint)]">{m.id.slice(3, 11)}</span>
                <span class="text-[11px] text-[var(--color-text-muted)]">{formatRelativeTime(m.started_at)}</span>
                {m.ended_at !== null
                  ? <Pill tone="cancelled">ended</Pill>
                  : <Pill tone="running">live</Pill>}
                <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">{m.entry_count} turns</span>
              </div>
              <div class="text-[12px] text-[var(--color-text)] line-clamp-1">{m.preview || '(no messages yet)'}</div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Meet pane ──────────────────────────────────────────────────────

function MeetPane() {
  const sessions = useFetch<{ active: MeetSession[]; recent: MeetSession[] }>('/api/meet/sessions', 5_000);
  const active = sessions.data?.active ?? [];
  const recent = sessions.data?.recent ?? [];

  return (
    <div class="p-6 space-y-5">
      <section>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Active sessions</div>
        {sessions.loading && active.length === 0 && <PageState loading />}
        {!sessions.loading && active.length === 0 && (
          <div class="text-[11.5px] text-[var(--color-text-faint)]">No active video meetings.</div>
        )}
        <div class="space-y-1.5">
          {active.map((s) => <MeetRow key={s.id} session={s} live />)}
        </div>
      </section>

      <section>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Recent</div>
        {recent.length === 0 && (
          <div class="text-[11.5px] text-[var(--color-text-faint)]">None.</div>
        )}
        <div class="space-y-1.5">
          {recent.map((s) => <MeetRow key={s.id} session={s} live={false} />)}
        </div>
      </section>

      <section class="text-[11px] text-[var(--color-text-faint)] leading-relaxed">
        Sending an agent into a Meet (Pika) or creating a Daily.co room is currently driven from Telegram or via the legacy dashboard's Live Meetings card. The dedicated launcher UI lands in a follow-up.
      </section>
    </div>
  );
}

function MeetRow({ session, live }: { session: MeetSession; live: boolean }) {
  return (
    <div class="flex items-center gap-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded p-3 text-[11.5px]">
      <AgentAvatar agentId={session.agent_id} size={24} running={live} />
      <div class="flex-1 min-w-0">
        <div class="text-[12px] text-[var(--color-text)] truncate">{session.meet_url}</div>
        <div class="text-[10px] text-[var(--color-text-faint)]">{session.provider} · {session.status} · {formatRelativeTime(session.created_at)}</div>
      </div>
    </div>
  );
}
