import { useState, useEffect } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { useLocation, useRoute } from 'wouter-preact';
import { Save, RotateCcw, ArrowLeft, AlertTriangle, RefreshCw, Power } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { pushToast } from '@/lib/toasts';
import { theme } from '@/lib/theme';

// Monaco is ~400KB gzipped — lazy-load it so the dashboard's main bundle
// stays small. The editor page is rarely visited; users who never edit
// agent files never download Monaco.
const MonacoEditor = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.default })));

interface FilesResponse {
  agent_id: string;
  claude_md: string;
  agent_yaml: string;
  bot_token_redacted: boolean;
}

type TabKey = 'persona' | 'config';

export function AgentFiles() {
  const [, params] = useRoute<{ id: string }>('/agents/:id/files');
  const [, navigate] = useLocation();
  const agentId = params?.id || '';
  const [tab, setTab] = useState<TabKey>('persona');
  const [files, setFiles] = useState<FilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edited values, dirty flags, save state.
  const [personaDraft, setPersonaDraft] = useState('');
  const [configDraft, setConfigDraft] = useState('');
  const [personaDirty, setPersonaDirty] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [saving, setSaving] = useState<TabKey | null>(null);
  const [restarting, setRestarting] = useState(false);

  // Load files once, then again whenever the agent id changes.
  useEffect(() => { void load(); }, [agentId]);

  async function load() {
    if (!agentId) return;
    setLoading(true); setError(null);
    try {
      const data = await apiGet<FilesResponse>(`/api/agents/${encodeURIComponent(agentId)}/files`);
      setFiles(data);
      setPersonaDraft(data.claude_md);
      setConfigDraft(data.agent_yaml);
      setPersonaDirty(false);
      setConfigDirty(false);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally { setLoading(false); }
  }

  async function savePersona() {
    setSaving('persona');
    try {
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/files/claudemd`, { content: personaDraft });
      pushToast({ tone: 'success', title: 'Persona saved', description: 'Takes effect on the next message.' });
      setPersonaDirty(false);
      void load();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Save failed', description: extractError(err), durationMs: 7000 });
    } finally { setSaving(null); }
  }

  async function saveConfig() {
    setSaving('config');
    try {
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/files/agent-yaml`, { content: configDraft });
      pushToast({
        tone: 'warn',
        title: 'Config saved',
        description: 'Restart agent to apply.',
        durationMs: 8000,
      });
      setConfigDirty(false);
      void load();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Save failed', description: extractError(err), durationMs: 7000 });
    } finally { setSaving(null); }
  }

  function extractError(err: any): string {
    // ApiError surfaces the body — pull a server-side error message
    // when present so YAML validation feedback reaches the toast.
    const body = err?.body;
    if (body && typeof body === 'object' && typeof body.error === 'string') return body.error;
    return err?.message || String(err);
  }

  async function restart() {
    if (!confirm(`Restart agent "${agentId}"? This will interrupt any in-flight tasks and reload its config.`)) return;
    setRestarting(true);
    try {
      await apiPost(`/api/agents/${encodeURIComponent(agentId)}/restart`);
      pushToast({ tone: 'success', title: 'Restarting', description: 'Agent will be back in ~5s.' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Restart failed', description: err?.message || String(err), durationMs: 7000 });
    } finally {
      setTimeout(() => setRestarting(false), 5000);
    }
  }

  function reset(which: TabKey) {
    if (!files) return;
    if (which === 'persona') { setPersonaDraft(files.claude_md); setPersonaDirty(false); }
    else { setConfigDraft(files.agent_yaml); setConfigDirty(false); }
  }

  const dirty = tab === 'persona' ? personaDirty : configDirty;
  const draft = tab === 'persona' ? personaDraft : configDraft;
  const language = tab === 'persona' ? 'markdown' : 'yaml';
  const monacoTheme = monacoThemeFor(theme.value);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={`Agent files · ${agentId}`}
        breadcrumb="Agents"
        tabs={
          <>
            <button
              type="button"
              onClick={() => navigate('/agents')}
              class="text-[12px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] mr-3 inline-flex items-center gap-1"
            >
              <ArrowLeft size={12} /> Back
            </button>
            <Tab label="Persona (CLAUDE.md)" active={tab === 'persona'} onClick={() => setTab('persona')} />
            <Tab label="Config (agent.yaml)" active={tab === 'config'} onClick={() => setTab('config')} />
          </>
        }
        actions={
          <>
            {tab === 'config' && files?.bot_token_redacted && (
              <span class="text-[10.5px] text-[var(--color-text-muted)] inline-flex items-center gap-1 mr-1">
                <AlertTriangle size={11} class="text-[var(--color-status-failed)]" />
                bot_token redacted
              </span>
            )}
            <span class={'text-[11.5px] tabular-nums mr-1 ' + (dirty ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-faint)]')}>
              {dirty ? '● modified' : 'saved'}
            </span>
            <button
              type="button"
              onClick={() => reset(tab)}
              disabled={!dirty || saving !== null}
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border border-[var(--color-border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              type="button"
              onClick={tab === 'persona' ? savePersona : saveConfig}
              disabled={!dirty || saving !== null}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={13} /> {saving === tab ? 'Saving…' : 'Save'}
            </button>
            {tab === 'config' && (
              <button
                type="button"
                onClick={restart}
                disabled={restarting || saving !== null}
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[12px] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors disabled:opacity-40"
                title="Restart this agent — required for agent.yaml changes to apply"
              >
                {restarting ? <RefreshCw size={12} class="animate-spin" /> : <Power size={12} />}
                {restarting ? 'Restarting…' : 'Restart agent'}
              </button>
            )}
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && <PageState loading />}

      {files && (
        <>
          <div class="px-6 py-2 border-b border-[var(--color-border)] text-[11.5px] text-[var(--color-text-muted)] leading-snug">
            {tab === 'persona' ? (
              <>
                <strong class="text-[var(--color-text)]">CLAUDE.md</strong> is the agent's persona/instructions. The Agent SDK re-reads it from disk on every turn, so saves take effect on the next message — no restart needed.
              </>
            ) : (
              <>
                <strong class="text-[var(--color-text)]">agent.yaml</strong> defines model, description, and bot token. The agent process loads it once at startup, so changes require a restart. The bot token is redacted in this editor; to change it, edit <code class="font-mono text-[var(--color-text-faint)]">.env</code> directly.
              </>
            )}
          </div>
          <div class="flex-1 min-h-0">
            <Suspense fallback={<div class="p-6 text-[var(--color-text-faint)] text-[12px]">Loading editor…</div>}>
              <MonacoEditor
                height="100%"
                language={language}
                value={draft}
                theme={monacoTheme}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13.5,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  lineNumbers: 'on',
                  wordWrap: tab === 'persona' ? 'on' : 'off',
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  padding: { top: 12, bottom: 12 },
                  automaticLayout: true,
                }}
                onChange={(v) => {
                  const next = v ?? '';
                  if (tab === 'persona') {
                    setPersonaDraft(next);
                    setPersonaDirty(next !== files.claude_md);
                  } else {
                    setConfigDraft(next);
                    setConfigDirty(next !== files.agent_yaml);
                  }
                }}
              />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
}

// Map our three workspace themes to Monaco's bundled palette. We could
// register a custom Monaco theme to match exactly, but vs-dark is close
// enough and avoids a per-theme JSON definition file.
function monacoThemeFor(name: string): string {
  switch (name) {
    case 'midnight': return 'vs-dark';
    case 'crimson': return 'vs-dark';
    default: return 'vs-dark';
  }
}
