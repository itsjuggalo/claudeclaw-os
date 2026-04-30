import { useEffect, useState } from 'preact/hooks';
import { Save, Zap } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { AgentAvatar } from '@/components/AgentAvatar';
import { apiGet, apiPost } from '@/lib/api';

interface VoiceRow { agent: string; gemini_voice: string; voice_id: string; name: string; is_default: boolean; }
interface CatalogEntry { name: string; style: string; }

export function Voices() {
  const [rows, setRows] = useState<VoiceRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const data = await apiGet<{ ok: boolean; voices: VoiceRow[]; gemini_catalog: CatalogEntry[]; error?: string }>('/api/warroom/voices');
      if (!data.ok) throw new Error(data.error || 'Failed to load voices');
      setRows(data.voices); setCatalog(data.gemini_catalog); setEdits({}); setDirty(new Set());
    } catch (err: any) { setError(err?.message || String(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function changeVoice(agent: string, voice: string) {
    setEdits((prev) => ({ ...prev, [agent]: voice }));
    setDirty((prev) => {
      const next = new Set(prev);
      const original = rows.find((r) => r.agent === agent)?.gemini_voice;
      if (voice === original) next.delete(agent); else next.add(agent);
      return next;
    });
    setStatus(null);
  }

  async function save(thenApply: boolean) {
    if (dirty.size === 0) return;
    setSaving(true); setStatus(null);
    try {
      const updates = Array.from(dirty).map((agent) => ({ agent, gemini_voice: edits[agent] }));
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/warroom/voices', { updates });
      if (!res.ok) throw new Error(res.error || 'Save failed');
      setStatus('Saved.');
      await load();
      if (thenApply) await apply();
    } catch (err: any) { setError(err?.message || String(err)); }
    finally { setSaving(false); }
  }

  async function apply() {
    setApplying(true); setStatus('Applying — bouncing voice subprocess…');
    try {
      const res = await apiPost<{ ok: boolean; killed_pids?: number[]; error?: string }>('/api/warroom/voices/apply');
      if (!res.ok) throw new Error(res.error || 'Apply failed');
      setStatus(`Applied. Bounced ${res.killed_pids?.length || 0} subprocess(es).`);
    } catch (err: any) { setError(err?.message || String(err)); }
    finally { applying && setTimeout(() => setApplying(false), 5000); setApplying(false); }
  }

  function effective(agent: string): string {
    if (edits[agent] !== undefined) return edits[agent];
    return rows.find((r) => r.agent === agent)?.gemini_voice || '';
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Voices"
        actions={
          <>
            {status && <span class="text-[11px] text-[var(--color-text-muted)]">{status}</span>}
            <button
              type="button"
              onClick={() => save(false)}
              disabled={dirty.size === 0 || saving || applying}
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={13} /> {saving ? 'Saving…' : `Save${dirty.size > 0 ? ` (${dirty.size})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={dirty.size === 0 || saving || applying}
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Zap size={13} /> Save & Apply
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && rows.length === 0 && <PageState loading />}
      {!loading && rows.length === 0 && (
        <PageState empty emptyTitle="Voice War Room not enabled" emptyDescription="Set WARROOM_ENABLED=true in .env and restart to enable voice meetings." />
      )}

      {rows.length > 0 && (
        <div class="flex-1 overflow-y-auto p-6 max-w-2xl">
          <div class="text-[11px] text-[var(--color-text-muted)] mb-3 leading-relaxed">
            Each agent uses a Gemini Live voice during voice War Room meetings. Save records the change in <code class="font-mono text-[var(--color-text-faint)]">warroom/voices.json</code>; Apply also bounces the Pipecat subprocess so the change takes effect immediately.
          </div>
          <div class="space-y-1.5">
            {rows.map((r) => {
              const isDirty = dirty.has(r.agent);
              return (
                <div
                  key={r.agent}
                  class={[
                    'flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors',
                    isDirty
                      ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)]'
                      : 'bg-[var(--color-card)] border-[var(--color-border)]',
                  ].join(' ')}
                >
                  <AgentAvatar agentId={r.agent} size={28} running />
                  <div class="flex-1 min-w-0">
                    <div class="text-[12.5px] text-[var(--color-text)] font-medium truncate">{r.agent}</div>
                    {isDirty && <div class="text-[10px] text-[var(--color-accent)]">modified</div>}
                  </div>
                  <select
                    value={effective(r.agent)}
                    onChange={(e) => changeVoice(r.agent, (e.target as HTMLSelectElement).value)}
                    class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {catalog.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} — {c.style}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
