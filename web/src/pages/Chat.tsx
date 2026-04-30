import { useEffect, useRef, useState } from 'preact/hooks';
import { Send, Square, Sparkles } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { StatusDot } from '@/components/Pill';
import { useFetch } from '@/lib/useFetch';
import { apiGet, apiPost, tokenizedSseUrl, chatId } from '@/lib/api';

interface Turn { role: 'user' | 'assistant'; content: string; source?: string; created_at?: number; }
interface Agent { id: string; name: string; running: boolean; }

export function Chat() {
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 60_000);
  const [activeAgent, setActiveAgent] = useState<string>('all');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Load conversation history when active agent changes.
  useEffect(() => {
    setLoading(true);
    const path = activeAgent === 'all'
      ? `/api/chat/history?chatId=${encodeURIComponent(chatId)}&limit=50`
      : `/api/agents/${activeAgent}/conversation?chatId=${encodeURIComponent(chatId)}&limit=50`;
    apiGet<{ turns: Turn[] }>(path)
      .then((d) => setTurns(d.turns || []))
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false));
  }, [activeAgent]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [turns, processing]);

  // Open SSE stream once for the lifetime of the page.
  useEffect(() => {
    const url = tokenizedSseUrl('/api/chat/stream');
    const es = new EventSource(url);
    es.onopen = () => setStreamConnected(true);
    es.onerror = () => setStreamConnected(false);

    const onUser = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setTurns((prev) => [...prev, { role: 'user', content: data.content, source: data.source }]);
      } catch {}
    };
    const onAssistant = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setTurns((prev) => [...prev, { role: 'assistant', content: data.content, source: data.source }]);
        setProcessing(false); setProgressLabel(null);
      } catch {}
    };
    const onProcessing = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.processing !== undefined) setProcessing(!!data.processing);
        if (!data.processing) setProgressLabel(null);
      } catch {}
    };
    const onProgress = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.description) setProgressLabel(data.description);
      } catch {}
    };
    const onErr = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setTurns((prev) => [...prev, { role: 'assistant', content: data.content || 'Error' }]);
      } catch {}
      setProcessing(false); setProgressLabel(null);
    };

    es.addEventListener('user_message', onUser);
    es.addEventListener('assistant_message', onAssistant);
    es.addEventListener('processing', onProcessing);
    es.addEventListener('progress', onProgress);
    es.addEventListener('error', onErr as any);

    return () => {
      es.removeEventListener('user_message', onUser);
      es.removeEventListener('assistant_message', onAssistant);
      es.removeEventListener('processing', onProcessing);
      es.removeEventListener('progress', onProgress);
      es.removeEventListener('error', onErr as any);
      es.close();
    };
  }, []);

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setSending(true); setError(null);
    try {
      const res = await apiPost<{ ok?: boolean; error?: string }>('/api/chat/send', { message });
      if (!res.ok && res.error) {
        setError(res.error === 'busy' ? 'A turn is already in flight. Wait for it to finish.' : res.error);
      } else {
        setDraft('');
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally { setSending(false); }
  }

  async function abort() {
    try { await apiPost('/api/chat/abort'); } catch {}
  }

  const agentList = agents.data?.agents ?? [];

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Chat"
        actions={
          <span class="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <StatusDot tone={streamConnected ? 'done' : 'cancelled'} />
            {streamConnected ? 'Stream live' : 'Reconnecting…'}
          </span>
        }
        tabs={
          <>
            <TabBtn label="All" active={activeAgent === 'all'} onClick={() => setActiveAgent('all')} />
            {agentList.map((a) => (
              <TabBtn key={a.id} label={a.name || a.id} active={activeAgent === a.id} onClick={() => setActiveAgent(a.id)} live={a.running} />
            ))}
          </>
        }
      />

      <div ref={messagesRef} class="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {error && <div class="text-[var(--color-status-failed)] text-[11.5px]">{error}</div>}
        {loading && <PageState loading />}
        {!loading && turns.length === 0 && (
          <PageState empty emptyTitle="No messages yet" emptyDescription="Type below to talk to your agent. Replies stream in via SSE." />
        )}
        {turns.map((t, i) => <Bubble key={i} turn={t} />)}
        {processing && <ProcessingBubble label={progressLabel} />}
      </div>

      <div class="border-t border-[var(--color-border)] p-4">
        <div class="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) void send();
              }
            }}
            placeholder="Type a message. Shift+Enter for newline."
            rows={1}
            class="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] resize-none max-h-32"
          />
          {processing ? (
            <button
              type="button"
              onClick={abort}
              class="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-medium bg-[var(--color-status-failed)] text-white hover:opacity-90 transition-opacity"
            >
              <Square size={12} fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              class="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={12} /> {sending ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick, live }: { label: string; active: boolean; onClick: () => void; live?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors',
        active
          ? 'bg-[var(--color-elevated)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
      ].join(' ')}
    >
      {live !== undefined && <StatusDot tone={live ? 'done' : 'cancelled'} />}
      {label}
    </button>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === 'user';
  return (
    <div class={'flex ' + (isUser ? 'justify-end' : 'justify-start')}>
      <div
        class={[
          'max-w-[75%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap',
          isUser
            ? 'bg-[var(--color-accent)] text-white rounded-br-sm'
            : 'bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] rounded-bl-sm',
        ].join(' ')}
      >
        {turn.content}
        {turn.source === 'dashboard' && (
          <div class="text-[9.5px] opacity-60 mt-1 uppercase tracking-wider">via dashboard</div>
        )}
      </div>
    </div>
  );
}

function ProcessingBubble({ label }: { label: string | null }) {
  return (
    <div class="flex justify-start">
      <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg rounded-bl-sm px-3 py-2 text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-2">
        <Sparkles size={12} class="animate-pulse text-[var(--color-accent)]" />
        {label || 'Thinking…'}
      </div>
    </div>
  );
}
