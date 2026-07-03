import { useState } from 'preact/hooks';
import { RefreshCw, Pin, PinOff, Archive, ExternalLink, ChevronRight, ChevronDown, Save, Check } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { NestedSquaresSpinner } from '@/components/NestedSquaresSpinner';
import { useFetch } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';
import { apiPost } from '@/lib/api';
import { pushToast } from '@/lib/toasts';

interface BunkerEntry {
  slug: string;
  title: string;
  task: string | null;
  tags: string[];
  created: string;
  pinned: boolean;
  url: string;
  archived: boolean;
  promoted: boolean;
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Artifact URLs come from the API pre-signed with a per-slug scoped capability
// (?t=&exp=), so we open them as-is — the master dashboard token is never put
// in an artifact URL. Opened in a NEW TAB (never iframed): the dashboard sends
// X-Frame-Options: DENY on every response by design.

export function Bunker() {
  const { data, loading, error, refresh } = useFetch<{
    entries: BunkerEntry[];
    archived: BunkerEntry[];
  }>('/api/bunker', 30_000);
  const entries = data?.entries ?? [];
  const archived = data?.archived ?? [];
  const [showArchive, setShowArchive] = useState(false);
  const { busy: refreshing, spin } = useSpin();

  const togglePin = async (e: BunkerEntry) => {
    try {
      await apiPost(`/api/bunker/${encodeURIComponent(e.slug)}/pin`, { pinned: !e.pinned });
      refresh();
    } catch (err) {
      pushToast({ tone: 'error', title: err instanceof Error ? err.message : 'Pin failed' });
    }
  };

  const archive = async (e: BunkerEntry) => {
    try {
      await apiPost(`/api/bunker/${encodeURIComponent(e.slug)}/archive`);
      pushToast({ tone: 'success', title: `Archived "${e.title}"` });
      refresh();
    } catch (err) {
      pushToast({ tone: 'error', title: err instanceof Error ? err.message : 'Archive failed' });
    }
  };

  const promote = async (e: BunkerEntry) => {
    try {
      const res = await apiPost<{ vaultPath: string }>(`/api/bunker/${encodeURIComponent(e.slug)}/promote`);
      pushToast({ tone: 'success', title: 'Saved to vault', description: res.vaultPath });
      refresh();
    } catch (err) {
      pushToast({ tone: 'error', title: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  return (
    <div class="flex flex-col h-full overflow-hidden select-text">
      <PageHeader
        title="Bunker"
        breadcrumb="Workspace"
        actions={
          <button
            type="button"
            onClick={() => void spin(refresh)}
            disabled={refreshing}
            aria-busy={refreshing}
            class="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {refreshing ? <NestedSquaresSpinner size={13} /> : <RefreshCw size={13} />} Refresh
          </button>
        }
      />

      <div class="flex-1 overflow-auto px-6 py-4">
        <p class="text-[12px] text-[var(--color-text-muted)] mb-4">
          Ad-hoc reports and artifacts, in one place. Unpinned entries archive after 7 days.
        </p>

        {error && (
          <div class="mb-3 p-3 rounded-md border border-red-800 bg-red-900/30 text-[12px] text-red-200">
            {error}
          </div>
        )}

        {loading && entries.length === 0 ? (
          <p class="text-[12px] text-[var(--color-text-faint)]">Loading…</p>
        ) : entries.length === 0 ? (
          <div class="max-w-xl rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[12px] text-[var(--color-text-muted)] space-y-2">
            <p class="text-[var(--color-text)] font-medium">Nothing on the bunker yet.</p>
            <p>Drop an artifact instead of spinning up a server:</p>
            <code class="block rounded bg-[var(--color-bg)] p-2 text-[11px] text-[var(--color-text)] whitespace-pre-wrap">
              node scripts/bunker-add.mjs --title "My report" report.html
            </code>
            <p>
              or write <code class="text-[var(--color-text)]">~/.claudeclaw/bunker/&lt;slug&gt;/index.html</code> directly.
            </p>
          </div>
        ) : (
          <ul class="space-y-2 max-w-3xl">
            {entries.map((e) => (
              <li
                key={e.slug}
                class="flex items-center gap-3 p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-text-faint)] transition-colors"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    {e.pinned && <Pin size={13} class="text-yellow-400 shrink-0" />}
                    <span class="text-[13px] font-medium text-[var(--color-text)] truncate">{e.title}</span>
                  </div>
                  {e.task && <p class="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">{e.task}</p>}
                  <div class="flex items-center gap-2 mt-1">
                    <span class="text-[11px] text-[var(--color-text-faint)]">{relativeTime(e.created)}</span>
                    {e.tags.map((t) => (
                      <span key={t} class="text-[10px] px-1.5 rounded bg-[var(--color-bg)] text-[var(--color-text-muted)]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    class="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md bg-[var(--color-bg)] text-[var(--color-text)] hover:text-blue-400"
                  >
                    <ExternalLink size={13} /> Open
                  </a>
                  {e.promoted ? (
                    <span
                      title="Saved to vault (searchable)"
                      class="flex items-center gap-1 text-[11px] px-1.5 py-1 text-green-400"
                    >
                      <Check size={13} /> Saved
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => promote(e)}
                      title="Save to vault (makes it searchable via context search)"
                      class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-green-400"
                    >
                      <Save size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => togglePin(e)}
                    title={e.pinned ? 'Unpin' : 'Pin (keep past expiry)'}
                    class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-yellow-400"
                  >
                    {e.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => archive(e)}
                    title="Move to archive"
                    class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-red-400"
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <div class="mt-6 max-w-3xl">
            <button
              type="button"
              onClick={() => setShowArchive((s) => !s)}
              class="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {showArchive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Archived ({archived.length})
            </button>
            {showArchive && (
              <ul class="mt-2 space-y-1">
                {archived.map((e) => (
                  <li key={e.slug} class="flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--color-text-muted)]">
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      class="truncate hover:text-[var(--color-text)]"
                    >
                      {e.title}
                    </a>
                    <span class="text-[var(--color-text-faint)] shrink-0">· {relativeTime(e.created)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
