import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useSearch } from 'wouter-preact';
import { Database, RefreshCw, ChevronRight, ChevronDown, Play, AlertTriangle, Table2, Pencil, Trash2, Plus, Undo2, Shield, ShieldCheck, X, History, HardDrive, Clock } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { NestedSquaresSpinner } from '@/components/NestedSquaresSpinner';
import { useFetch } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';
import { apiGet, apiPost } from '@/lib/api';
import { formatRelativeTime, formatNumber } from '@/lib/format';
// Page-scoped fonts (self-hosted) — injected under private family names so the
// rest of the dashboard keeps its own type. See injectSqlMonFonts().
import interReg from '@fontsource/inter/files/inter-latin-400-normal.woff2';
import interMed from '@fontsource/inter/files/inter-latin-500-normal.woff2';
import interSemi from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2';
import jbReg from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2';
import jbMed from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2';

interface SqlDbInfo {
  id: string; label: string; subtitle?: string; group: string;
  size: string; bytes: number; tables: number; walSize: string;
  updated: string | null; live: boolean; stale: boolean; infra: boolean; writable: boolean;
}
interface SqlCatalogGroup { id: string; label: string; items: SqlDbInfo[]; }
interface SqlCatalog { groups: SqlCatalogGroup[]; totalBytes: number; generatedAt: number; }

interface SqlTablesResult {
  id: string; label: string; size: string; updated: string | null;
  tables: Array<{ name: string; rows: number }>;
}
interface SqlSelectResult { columns: string[]; rows: unknown[][]; elapsed_ms: number; capped: boolean; }

type RowKey = { rowid?: number | string; pk?: Record<string, unknown> };
interface ModRowsResult {
  id: string; label: string; table: string; writable: boolean;
  columns: string[]; hasRowid: boolean; pkCols: string[];
  rows: Array<{ __key: RowKey; cells: unknown[] }>;
  total: number; offset: number; capped: boolean;
}
interface AuditEntry {
  id: number; ts: string; db_id: string; db_label: string | null; tbl: string;
  action: string; row_key: string | null; before_json: string | null; after_json: string | null;
  ip: string | null; backup_path: string | null; undone_at: string | null;
}

const agoFromIso = (iso: string | null) => (iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : '—');
const cellStr = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const keyStr = (k: RowKey) => (k.rowid != null ? `r:${k.rowid}` : `pk:${JSON.stringify(k.pk || {})}`);
const dbIdFromSearch = (search: string) => {
  try { return new URLSearchParams(search).get('db'); } catch { return null; }
};

// ── Page-scoped font injection (once) ─────────────────────────────────
// We register Inter + JetBrains Mono under PRIVATE family names and apply them
// only inside `.sqlmon`, so the global dashboard typography is untouched.
let _fontsInjected = false;
function injectSqlMonFonts(): void {
  if (_fontsInjected || typeof document === 'undefined') return;
  _fontsInjected = true;
  const ff = (fam: string, url: string, w: number) =>
    `@font-face{font-family:'${fam}';src:url(${url}) format('woff2');font-weight:${w};font-style:normal;font-display:swap}`;
  const css = [
    ff('SqlMonSans', interReg, 400), ff('SqlMonSans', interMed, 500), ff('SqlMonSans', interSemi, 600), ff('SqlMonSans', interBold, 700),
    ff('SqlMonMono', jbReg, 400), ff('SqlMonMono', jbMed, 500),
    `.sqlmon{font-family:'SqlMonSans',ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;letter-spacing:-0.006em}`,
    `.sqlmon .font-mono,.sqlmon code,.sqlmon kbd,.sqlmon textarea,.sqlmon input{font-family:'SqlMonMono',ui-monospace,'SFMono-Regular',monospace;letter-spacing:0;font-feature-settings:'tnum' 1}`,
  ].join('');
  const el = document.createElement('style');
  el.id = 'sqlmon-fonts';
  el.textContent = css;
  document.head.appendChild(el);
}

// ── Confirm modal (typed-confirm for destructive actions) ─────────────
function ConfirmModal({ title, destructive, requireWord, body, busy, err, onCancel, onConfirm }: {
  title: string; destructive?: boolean; requireWord?: string;
  body: ComponentChildren; busy: boolean; err: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !requireWord || typed.trim().toLowerCase() === requireWord.toLowerCase();
  return (
    <div class="sqlmon fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={onCancel}>
      <div class="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div class="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text)]">
            {destructive && <AlertTriangle size={16} class="text-[var(--color-status-failed)]" />} {title}
          </div>
          <button type="button" onClick={onCancel} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        <div class="px-4 py-3 max-h-[50vh] overflow-y-auto text-[12px] text-[var(--color-text-muted)]">{body}</div>
        {requireWord && (
          <div class="px-4 pb-1">
            <div class="text-[11px] text-[var(--color-text-faint)] mb-1">Type <span class="font-mono font-semibold text-[var(--color-status-failed)]">{requireWord}</span> to confirm</div>
            <input value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} spellcheck={false}
              class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--color-text)]" />
          </div>
        )}
        {err && <div class="mx-4 mb-2 rounded-lg border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-status-failed)]">{err}</div>}
        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button type="button" onClick={onCancel} class="rounded-lg px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy || !ok}
            class="rounded-lg px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40 shadow-sm"
            style={`background:${destructive ? 'var(--color-status-failed)' : 'var(--color-accent)'}`}>
            {busy ? 'Working…' : destructive ? 'Confirm delete' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// One editable cell: text input + a "null" toggle.
function cellEditor(col: string, draft: Record<string, { v: string; isNull: boolean }>, setDraft: (f: (d: Record<string, { v: string; isNull: boolean }>) => Record<string, { v: string; isNull: boolean }>) => void) {
  const d = draft[col];
  if (!d) return null;
  return (
    <div class="flex items-center gap-1 min-w-[120px]">
      <input value={d.v} disabled={d.isNull} spellcheck={false}
        onInput={(e) => { const v = (e.target as HTMLInputElement).value; setDraft((p) => ({ ...p, [col]: { v, isNull: false } })); }}
        class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-[11px] font-mono text-[var(--color-text)] disabled:opacity-40 focus:border-[var(--color-accent)] outline-none" />
      <button type="button" title="set NULL" onClick={() => setDraft((p) => ({ ...p, [col]: { v: d.isNull ? '' : p[col].v, isNull: !d.isNull } }))}
        class={`shrink-0 rounded px-1 py-0.5 text-[9px] font-mono border ${d.isNull ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-faint)]'}`}>∅</button>
    </div>
  );
}

// ── Editable moderation grid for ONE writable table ───────────────────
function ModerationGrid({ db, table, onClose, onChanged }: { db: SqlDbInfo; table: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<ModRowsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);     // keyStr of row being edited, or 'NEW'
  const [draft, setDraft] = useState<Record<string, { v: string; isNull: boolean }>>({});
  const [confirm, setConfirm] = useState<null | { kind: 'update' | 'delete' | 'insert'; key?: RowKey; changes?: Record<string, unknown>; values?: Record<string, unknown>; body: ComponentChildren }>(null);
  const [busy, setBusy] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await apiGet<ModRowsResult | { error: string }>(`/api/sql/${db.id}/rows?table=${encodeURIComponent(table)}&offset=${offset}`);
      if ('error' in r) setErr(r.error); else setData(r);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [db.id, table, offset]);

  const cols = data?.columns ?? [];
  const startEdit = (k: RowKey, cells: unknown[]) => {
    setEditing(keyStr(k));
    const d: Record<string, { v: string; isNull: boolean }> = {};
    cols.forEach((c, i) => { d[c] = { v: cellStr(cells[i]), isNull: cells[i] == null }; });
    setDraft(d);
  };
  const startInsert = () => {
    setEditing('NEW');
    const d: Record<string, { v: string; isNull: boolean }> = {};
    cols.forEach((c) => { d[c] = { v: '', isNull: true }; });
    setDraft(d);
  };
  const draftValue = (c: string): unknown => (draft[c].isNull ? null : draft[c].v);

  function askSaveEdit(orig: { __key: RowKey; cells: unknown[] }) {
    const changes: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      const cur = orig.cells[i];
      const next = draftValue(c);
      const changed = (cur == null) !== (next == null) || (cur != null && String(cur) !== String(next));
      if (changed) changes[c] = next;
    });
    if (!Object.keys(changes).length) { setEditing(null); return; }
    setCErr(null);
    setConfirm({
      kind: 'update', key: orig.__key, changes,
      body: (
        <div>
          <div class="mb-2 text-[var(--color-text-faint)]">Updating <span class="font-mono text-[var(--color-text)]">{table}</span> · {keyStr(orig.__key)}</div>
          <table class="w-full text-[11px]"><tbody>
            {Object.keys(changes).map((c) => {
              const i = cols.indexOf(c);
              return (
                <tr key={c} class="border-b border-[var(--color-border)] last:border-0">
                  <td class="py-1 pr-3 font-mono text-[var(--color-text-muted)] align-top">{c}</td>
                  <td class="py-1 pr-2 font-mono text-[var(--color-status-failed)] line-through align-top max-w-[180px] truncate" title={cellStr(orig.cells[i])}>{orig.cells[i] == null ? 'null' : cellStr(orig.cells[i])}</td>
                  <td class="py-1 font-mono text-[var(--color-status-done)] align-top max-w-[180px] truncate" title={cellStr(changes[c])}>{changes[c] == null ? 'null' : cellStr(changes[c])}</td>
                </tr>
              );
            })}
          </tbody></table>
        </div>
      ),
    });
  }
  function askInsert() {
    const provided: Record<string, unknown> = {};
    cols.forEach((c) => { if (!draft[c].isNull || draft[c].v !== '') provided[c] = draftValue(c); });
    setCErr(null);
    setConfirm({
      kind: 'insert', values: provided,
      body: (
        <div>
          <div class="mb-2 text-[var(--color-text-faint)]">Inserting a new row into <span class="font-mono text-[var(--color-text)]">{table}</span></div>
          <table class="w-full text-[11px]"><tbody>
            {cols.map((c) => (
              <tr key={c} class="border-b border-[var(--color-border)] last:border-0">
                <td class="py-1 pr-3 font-mono text-[var(--color-text-muted)]">{c}</td>
                <td class="py-1 font-mono text-[var(--color-text)] max-w-[260px] truncate">{draft[c].isNull ? <span class="italic text-[var(--color-text-faint)]">null</span> : draft[c].v}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ),
    });
  }
  function askDelete(orig: { __key: RowKey; cells: unknown[] }) {
    setCErr(null);
    setConfirm({
      kind: 'delete', key: orig.__key,
      body: (
        <div>
          <div class="mb-2 text-[var(--color-status-failed)] font-medium">This permanently deletes a row from <span class="font-mono">{table}</span>. A backup + before-image is saved (undoable from the history panel).</div>
          <table class="w-full text-[11px]"><tbody>
            {cols.map((c, i) => (
              <tr key={c} class="border-b border-[var(--color-border)] last:border-0">
                <td class="py-1 pr-3 font-mono text-[var(--color-text-muted)] align-top">{c}</td>
                <td class="py-1 font-mono text-[var(--color-text)] max-w-[320px] truncate" title={cellStr(orig.cells[i])}>{orig.cells[i] == null ? <span class="italic text-[var(--color-text-faint)]">null</span> : cellStr(orig.cells[i])}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ),
    });
  }

  async function doConfirm() {
    if (!confirm) return;
    setBusy(true); setCErr(null);
    try {
      let r: { error?: string };
      if (confirm.kind === 'update') r = await apiPost(`/api/sql/${db.id}/row/update`, { table, key: confirm.key, changes: confirm.changes });
      else if (confirm.kind === 'delete') r = await apiPost(`/api/sql/${db.id}/row/delete`, { table, key: confirm.key });
      else r = await apiPost(`/api/sql/${db.id}/row/insert`, { table, values: confirm.values });
      if (r && r.error) { setCErr(r.error); return; }
      setConfirm(null); setEditing(null);
      await load(); onChanged();
    } catch (e: any) { setCErr(e?.message || String(e)); } finally { setBusy(false); }
  }

  return (
    <div class="rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-border))] bg-[var(--color-bg)] overflow-hidden shadow-sm">
      <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]">
        <div class="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text)]">
          <Table2 size={13} class="text-[var(--color-accent)]" /> <span class="font-mono">{table}</span>
          {data && <span class="text-[var(--color-text-faint)] font-normal font-mono">· {formatNumber(data.total)} rows</span>}
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onClick={startInsert} disabled={!data || editing === 'NEW'}
            class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40 shadow-sm" style="background:var(--color-accent)">
            <Plus size={12} /> Add row
          </button>
          <button type="button" onClick={onClose} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]" title="Close"><X size={15} /></button>
        </div>
      </div>

      {loading && !data && <div class="px-3 py-3 text-[11px] text-[var(--color-text-faint)]">Loading rows…</div>}
      {err && <div class="px-3 py-3 text-[11px] font-mono text-[var(--color-status-failed)]">{err}</div>}

      {data && (
        <div class="overflow-x-auto max-h-[52vh] overflow-y-auto">
          <table class="w-full text-[11px] border-separate border-spacing-0">
            <thead class="bg-[var(--color-elevated)] text-left sticky top-0 z-10">
              <tr>
                <th class="px-2 py-2 w-[72px] border-b border-[var(--color-border)]"></th>
                {cols.map((c) => <th key={c} class="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] whitespace-nowrap border-b border-[var(--color-border)]">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {editing === 'NEW' && (
                <tr class="bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]">
                  <td class="px-2 py-1 align-top border-b border-[var(--color-border)]">
                    <div class="flex gap-1">
                      <button type="button" onClick={askInsert} title="Save new row" class="text-[var(--color-status-done)] hover:opacity-80"><Plus size={14} /></button>
                      <button type="button" onClick={() => setEditing(null)} title="Cancel" class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={14} /></button>
                    </div>
                  </td>
                  {cols.map((c) => <td key={c} class="px-1 py-1 align-top border-b border-[var(--color-border)]">{cellEditor(c, draft, setDraft)}</td>)}
                </tr>
              )}
              {data.rows.map((row) => {
                const ks = keyStr(row.__key);
                const isEd = editing === ks;
                return (
                  <tr key={ks} class={isEd ? 'bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]' : 'hover:bg-[var(--color-elevated)]'}>
                    <td class="px-2 py-1 align-top whitespace-nowrap border-b border-[var(--color-border)]">
                      {isEd ? (
                        <div class="flex gap-1">
                          <button type="button" onClick={() => askSaveEdit(row)} title="Save" class="text-[var(--color-status-done)] hover:opacity-80"><Pencil size={14} /></button>
                          <button type="button" onClick={() => setEditing(null)} title="Cancel" class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={14} /></button>
                        </div>
                      ) : (
                        <div class="flex gap-1.5">
                          <button type="button" onClick={() => startEdit(row.__key, row.cells)} title="Edit row" class="text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"><Pencil size={13} /></button>
                          <button type="button" onClick={() => askDelete(row)} title="Delete row" class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)]"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                    {row.cells.map((cell, ci) => (
                      <td key={ci} class="px-1 py-1 align-top border-b border-[var(--color-border)]">
                        {isEd ? cellEditor(cols[ci], draft, setDraft)
                          : <span class="block px-1.5 font-mono text-[var(--color-text-muted)] whitespace-nowrap max-w-[360px] truncate" title={cellStr(cell)}>{cell == null ? <span class="text-[var(--color-text-faint)] italic">null</span> : cellStr(cell)}</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (data.total > data.rows.length || offset > 0) && (
        <div class="flex items-center justify-between px-3 py-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)] font-mono">
          <span>rows {offset + 1}–{offset + data.rows.length} of {formatNumber(data.total)}</span>
          <div class="flex gap-2">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))} class="rounded-lg px-2 py-0.5 border border-[var(--color-border)] disabled:opacity-30 hover:text-[var(--color-text)]">‹ prev</button>
            <button type="button" disabled={!data.capped} onClick={() => setOffset(offset + 200)} class="rounded-lg px-2 py-0.5 border border-[var(--color-border)] disabled:opacity-30 hover:text-[var(--color-text)]">next ›</button>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'delete' ? 'Delete row' : confirm.kind === 'insert' ? 'Insert row' : 'Save changes'}
          destructive={confirm.kind === 'delete'} requireWord={confirm.kind === 'delete' ? 'delete' : undefined}
          body={confirm.body} busy={busy} err={cErr}
          onCancel={() => { setConfirm(null); setCErr(null); }} onConfirm={doConfirm} />
      )}
    </div>
  );
}

// ── Audit / undo history for a writable DB ────────────────────────────
function AuditPanel({ db, refreshKey }: { db: SqlDbInfo; refreshKey: number }) {
  const { data, refresh } = useFetch<{ entries: AuditEntry[] }>(`/api/sql/audit?db=${db.id}&limit=40`, 0);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [refreshKey]);
  const entries = data?.entries ?? [];
  if (!entries.length) return null;

  async function undo(id: number) {
    setBusy(id); setErr(null);
    try { const r = await apiPost<{ error?: string }>(`/api/sql/audit/${id}/undo`); if (r?.error) setErr(r.error); else refresh(); }
    catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(null); }
  }
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-muted)]">
        <History size={13} /> Change history <span class="text-[var(--color-text-faint)] font-normal font-mono">({entries.length})</span>
      </div>
      {err && <div class="px-3 py-1.5 text-[11px] font-mono text-[var(--color-status-failed)]">{err}</div>}
      <div class="max-h-[220px] overflow-y-auto divide-y divide-[var(--color-border)]">
        {entries.map((m) => {
          const color = m.action.startsWith('undo') ? 'var(--color-text-faint)' : m.action === 'delete' ? 'var(--color-status-failed)' : m.action === 'insert' ? 'var(--color-status-done)' : 'var(--color-accent)';
          return (
            <div key={m.id} class="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
              <div class="min-w-0 flex items-center gap-2">
                <span class="font-semibold uppercase font-mono text-[10px] px-1.5 py-0.5 rounded" style={`color:${color};background:color-mix(in srgb,${color} 12%,transparent)`}>{m.action}</span>
                <span class="font-mono text-[var(--color-text-muted)] truncate">{m.tbl}</span>
                <span class="text-[var(--color-text-faint)] font-mono truncate">{m.row_key}</span>
                <span class="text-[var(--color-text-faint)] whitespace-nowrap">{agoFromIso(m.ts)}</span>
              </div>
              {m.undone_at ? <span class="text-[10px] text-[var(--color-text-faint)] italic whitespace-nowrap">undone</span>
                : !m.action.startsWith('undo') && (
                  <button type="button" disabled={busy === m.id} onClick={() => undo(m.id)}
                    class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] disabled:opacity-40">
                    <Undo2 size={10} /> {busy === m.id ? '…' : 'undo'}
                  </button>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Small badge ───────────────────────────────────────────────────────
function Badge({ kind }: { kind: 'moderate' | 'readonly' | 'live' | 'stale' }) {
  if (kind === 'moderate') return (
    <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style="color:var(--color-accent);background:color-mix(in srgb,var(--color-accent) 14%,transparent)"><ShieldCheck size={10} /> moderate</span>);
  if (kind === 'readonly') return (
    <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-[var(--color-text-faint)]"
      style="background:color-mix(in srgb,var(--color-text-faint) 12%,transparent)"><Shield size={10} /> read-only</span>);
  if (kind === 'stale') return (
    <span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style="color:var(--color-warn);background:color-mix(in srgb,var(--color-warn) 14%,transparent)"><AlertTriangle size={10} /> stale</span>);
  return (
    <span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style="color:var(--color-status-done);background:color-mix(in srgb,var(--color-status-done) 14%,transparent)">live</span>);
}

// ── Left rail item (one DB) ───────────────────────────────────────────
function RailItem({ db, selected, onSelect }: { db: SqlDbInfo; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect}
      class={`w-full flex items-center gap-2 pl-3 pr-2.5 py-2 text-left border-l-2 transition-colors ${selected
        ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]'
        : 'border-transparent hover:bg-[var(--color-elevated)]'}`}>
      <Database size={13} class={selected ? 'text-[var(--color-accent)] shrink-0' : 'text-[var(--color-text-faint)] shrink-0'} />
      <div class="min-w-0 flex-1">
        <div class={`text-[12px] truncate ${selected ? 'font-semibold text-[var(--color-text)]' : 'font-medium text-[var(--color-text-muted)]'}`}>{db.label}</div>
        <div class="flex items-center gap-1.5 mt-0.5">
          {db.writable && <span class="inline-flex items-center gap-0.5 text-[9px] font-semibold text-[var(--color-accent)]"><ShieldCheck size={9} /> edit</span>}
          {db.live && !db.stale && <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-status-done)]" title="live" />}
          {db.stale && <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-warn)]" title="stale" />}
          <span class="text-[9px] text-[var(--color-text-faint)] font-mono">{db.size}</span>
        </div>
      </div>
    </button>
  );
}

// ── Table grouping — turn a flat table list into a "dropdown ladder" ──
// Groups tables by their name prefix (segment before the first underscore).
// Prefixes with a single table are folded into one "Other" group so the
// ladder stays scannable instead of exploding into dozens of one-item rows.
interface TableInfo { name: string; rows: number; }
interface TableGroup { id: string; label: string; items: TableInfo[]; }
function groupTables(tables: TableInfo[]): TableGroup[] {
  const byPrefix = new Map<string, TableInfo[]>();
  for (const t of tables) {
    const prefix = (t.name.split('_')[0] || t.name).toLowerCase();
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(t);
  }
  const groups: TableGroup[] = [];
  const singles: TableInfo[] = [];
  for (const [prefix, items] of byPrefix) {
    if (items.length >= 2) {
      items.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ id: prefix, label: prefix, items });
    } else {
      singles.push(items[0]);
    }
  }
  groups.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  if (singles.length) {
    singles.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ id: '__other', label: 'Other', items: singles });
  }
  return groups;
}

function TableChip({ t, active, writable, onClick }: { t: TableInfo; active: boolean; writable: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      title={writable ? `Moderate ${t.name}` : `Browse ${t.name}`}
      class={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${active ? 'border-[var(--color-accent)] text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'border-[var(--color-border)] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]'}`}>
      <Table2 size={11} class="opacity-60" />
      <span class="font-mono">{t.name}</span>
      <span class="font-mono text-[var(--color-text-faint)]">{t.rows < 0 ? '?' : formatNumber(t.rows)}</span>
    </button>
  );
}

// ── Detail pane: tables + (read) query + (write) moderation ───────────
function DetailPane({ db }: { db: SqlDbInfo }) {
  const { data, loading, error } = useFetch<SqlTablesResult | { error: string }>(`/api/sql/${db.id}/meta`, 0);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<SqlSelectResult | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modTable, setModTable] = useState<string | null>(null);
  const [auditKey, setAuditKey] = useState(0);
  const [openTableGroups, setOpenTableGroups] = useState<Set<string>>(() => new Set());

  // Reset table selection / query when the selected DB changes.
  useEffect(() => { setModTable(null); setResult(null); setSql(''); setQErr(null); setOpenTableGroups(new Set()); }, [db.id]);

  const meta = data && !('error' in data) ? data : null;
  const metaErr = data && 'error' in data ? data.error : error;
  // Ladder grouping kicks in only when there are enough tables to warrant it.
  const tableGroups = meta && meta.tables.length > 8 ? groupTables(meta.tables) : null;

  function toggleTableGroup(id: string) {
    setOpenTableGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function setAllTableGroups(open: boolean) {
    setOpenTableGroups(open && tableGroups ? new Set(tableGroups.map((g) => g.id)) : new Set());
  }

  async function run(query?: string) {
    const q = (query ?? sql).trim();
    if (!q) return;
    if (query) setSql(query);
    setRunning(true); setQErr(null); setResult(null);
    try {
      const r = await apiPost<SqlSelectResult | { error: string }>(`/api/sql/${db.id}/query`, { sql: q });
      if ('error' in r) setQErr(r.error); else setResult(r);
    } catch (e: any) { setQErr(e?.message || String(e)); } finally { setRunning(false); }
  }

  return (
    <div class="px-4 py-4 space-y-4">
      {/* Detail header */}
      <div class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] px-4 py-3.5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-[16px] font-semibold text-[var(--color-text)] truncate">{db.label}</h2>
              <Badge kind={db.writable ? 'moderate' : 'readonly'} />
              {db.live && !db.stale && <Badge kind="live" />}
              {db.stale && <Badge kind="stale" />}
            </div>
            {db.subtitle && <div class="text-[12px] text-[var(--color-text-faint)] mt-0.5">{db.subtitle}</div>}
          </div>
          <div class="flex items-center gap-3.5 text-[11px] text-[var(--color-text-muted)] font-mono shrink-0 pt-1">
            <span class="inline-flex items-center gap-1" title="size on disk"><HardDrive size={11} class="opacity-60" />{db.size}{db.walSize && <span class="text-[var(--color-text-faint)]"> +{db.walSize}</span>}</span>
            <span class="hidden sm:inline-flex items-center gap-1" title="tables"><Table2 size={11} class="opacity-60" />{db.tables < 0 ? '—' : db.tables}</span>
            <span class="hidden md:inline-flex items-center gap-1 text-[var(--color-text-faint)]" title={db.updated || ''}><Clock size={11} class="opacity-60" />{agoFromIso(db.updated)}</span>
          </div>
        </div>
      </div>

      {loading && !meta && <div class="text-[12px] text-[var(--color-text-faint)] px-1">Loading tables…</div>}
      {metaErr && <div class="text-[12px] text-[var(--color-status-failed)] font-mono px-1">{metaErr}</div>}

      {meta && (
        <>
          {/* Tables — writable: chip opens the editable grid; else it browses (read-only).
           *  Many tables (>8) collapse into a prefix-grouped dropdown ladder. */}
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] font-semibold">
                Tables ({meta.tables.length}){db.writable && <span class="ml-1.5 text-[var(--color-accent)] normal-case tracking-normal font-medium">— click to moderate</span>}
              </div>
              {tableGroups && (
                <button type="button"
                  onClick={() => setAllTableGroups(openTableGroups.size < tableGroups.length)}
                  class="text-[10px] font-semibold text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors">
                  {openTableGroups.size < tableGroups.length ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </div>
            {meta.tables.length === 0 ? (
              <div class="text-[12px] text-[var(--color-text-faint)]">No user tables.</div>
            ) : !tableGroups ? (
              <div class="flex flex-wrap gap-1.5">
                {meta.tables.map((t) => (
                  <TableChip key={t.name} t={t} active={modTable === t.name} writable={db.writable}
                    onClick={() => (db.writable ? setModTable(modTable === t.name ? null : t.name) : run(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 100`))} />
                ))}
              </div>
            ) : (
              <div class="space-y-1">
                {tableGroups.map((g) => {
                  const open = openTableGroups.has(g.id) || g.items.some((t) => t.name === modTable);
                  return (
                    <div key={g.id} class="rounded-lg border border-[var(--color-border)] overflow-hidden bg-[var(--color-elevated)]">
                      <button type="button" onClick={() => toggleTableGroup(g.id)} aria-expanded={open}
                        class="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] transition-colors">
                        {open ? <ChevronDown size={13} class="shrink-0 opacity-70" /> : <ChevronRight size={13} class="shrink-0 opacity-70" />}
                        <Table2 size={12} class="opacity-60 shrink-0" />
                        <span class="font-mono font-medium text-[var(--color-text)]">{g.label}{g.id !== '__other' && <span class="text-[var(--color-text-faint)]">_*</span>}</span>
                        <span class="ml-auto font-mono text-[10px] text-[var(--color-text-faint)]">{g.items.length}</span>
                      </button>
                      {open && (
                        <div class="flex flex-wrap gap-1.5 border-t border-[var(--color-border)] px-3 pb-2.5 pt-2">
                          {g.items.map((t) => (
                            <TableChip key={t.name} t={t} active={modTable === t.name} writable={db.writable}
                              onClick={() => (db.writable ? setModTable(modTable === t.name ? null : t.name) : run(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 100`))} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Moderation grid (writable DBs only) */}
          {db.writable && modTable && (
            <ModerationGrid db={db} table={modTable} onClose={() => setModTable(null)} onChanged={() => setAuditKey((k) => k + 1)} />
          )}
          {db.writable && <AuditPanel db={db} refreshKey={auditKey} />}

          {/* SELECT-only query box (read — available on every DB) */}
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] font-semibold">Query (SELECT-only)</div>
              <button type="button" onClick={() => run()} disabled={running || !sql.trim()}
                class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40 shadow-sm"
                style="background:var(--color-accent)">
                <Play size={11} /> {running ? 'Running…' : 'Run'}
              </button>
            </div>
            <textarea
              value={sql}
              onInput={(e) => setSql((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
              placeholder={`SELECT * FROM ... LIMIT 100   (⌘/Ctrl+Enter to run)`}
              rows={2}
              spellcheck={false}
              class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-mono text-[var(--color-text)] resize-y focus:border-[var(--color-accent)] outline-none" />
          </div>

          {qErr && (
            <div class="rounded-xl border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] px-3 py-2 text-[11px] font-mono text-[var(--color-status-failed)]">
              {qErr}
            </div>
          )}

          {result && (
            <div>
              <div class="text-[10px] text-[var(--color-text-faint)] mb-1 font-mono">
                {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · {result.elapsed_ms}ms
                {result.capped && <span class="text-[var(--color-warn)]"> · capped at 500</span>}
              </div>
              <div class="overflow-x-auto rounded-xl border border-[var(--color-border)] max-h-[360px] overflow-y-auto">
                <table class="w-full text-[11px] border-separate border-spacing-0">
                  <thead class="bg-[var(--color-elevated)] text-left sticky top-0">
                    <tr>
                      {result.columns.map((c, i) => (
                        <th key={i} class="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] whitespace-nowrap border-b border-[var(--color-border)]">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri} class="hover:bg-[var(--color-elevated)]">
                        {row.map((cell, ci) => (
                          <td key={ci} class="px-2.5 py-1.5 font-mono text-[var(--color-text-muted)] whitespace-nowrap max-w-[420px] truncate border-b border-[var(--color-border)]"
                            title={cell == null ? '' : String(cell)}>
                            {cell == null ? <span class="text-[var(--color-text-faint)] italic">null</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SqlMonitor() {
  injectSqlMonFonts();
  const search = useSearch();
  const { data, loading, error, refresh } = useFetch<SqlCatalog>('/api/sql', 30000);
  const { busy: refreshing, spin } = useSpin();
  const [selId, setSelId] = useState<string | null>(null);
  const [showInternals, setShowInternals] = useState(false);
  // Collapsible rail groups (default: all expanded). Tracks which are collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const requestedDbId = dbIdFromSearch(search);

  function toggleGroup(id: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const groups = data?.groups ?? [];
  const allDbs = groups.flatMap((g) => g.items);
  const mainGroups = groups.filter((g) => g.id !== 'internals');
  const internals = groups.find((g) => g.id === 'internals');
  const writableCount = allDbs.filter((d) => d.writable).length;

  // Auto-select a linked DB first, then the first moderatable DB (or first DB).
  useEffect(() => {
    if (!allDbs.length) return;
    if (requestedDbId && allDbs.some((d) => d.id === requestedDbId)) {
      setSelId(requestedDbId);
      return;
    }
    if (!selId || !allDbs.some((d) => d.id === selId)) setSelId((allDbs.find((d) => d.writable) || allDbs[0]).id);
    // eslint-disable-next-line
  }, [data, requestedDbId]);

  const sel = allDbs.find((d) => d.id === selId) || null;

  function selectDb(id: string) {
    setSelId(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('db', id);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }

  return (
    <div class="sqlmon flex flex-col h-full">
      <PageHeader
        title="SQL Databases"
        actions={
          <button type="button" onClick={() => void spin(refresh)} disabled={refreshing} aria-busy={refreshing} title="Refresh"
            class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {refreshing ? <NestedSquaresSpinner size={12} /> : <RefreshCw size={12} />} refresh
          </button>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}

      {data && (
        <div class="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* ── Left rail: every DB, grouped, kept separate ── */}
          <aside class="md:w-[268px] md:shrink-0 md:h-full md:border-r border-b md:border-b-0 border-[var(--color-border)] overflow-y-auto bg-[var(--color-bg)]">
            <div class="px-3 py-2.5 border-b border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)]">
              <span class="font-mono font-semibold text-[var(--color-text)]">{allDbs.length}</span> databases ·{' '}
              <span class="text-[var(--color-accent)] font-semibold">{writableCount}</span> moderatable
            </div>

            {mainGroups.map((g) => {
              const collapsed = collapsedGroups.has(g.id);
              return (
                <div key={g.id} class="py-1">
                  <button type="button" onClick={() => toggleGroup(g.id)} aria-expanded={!collapsed}
                    class="w-full flex items-center gap-1 px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors">
                    {collapsed ? <ChevronRight size={12} class="shrink-0" /> : <ChevronDown size={12} class="shrink-0" />}
                    <span class="min-w-0 flex-1 truncate text-left">{g.label}</span>
                    <span class="font-mono font-normal normal-case tracking-normal">({g.items.length})</span>
                  </button>
                  {!collapsed && g.items.map((db) => <RailItem key={db.id} db={db} selected={db.id === selId} onSelect={() => selectDb(db.id)} />)}
                </div>
              );
            })}

            {internals && internals.items.length > 0 && (
              <div class="py-1 border-t border-[var(--color-border)] mt-1">
                <button type="button" onClick={() => setShowInternals((s) => !s)}
                  class="w-full flex items-center gap-1 px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
                  {showInternals ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Internals <span class="font-mono font-normal normal-case tracking-normal">({internals.items.length})</span>
                </button>
                {showInternals && internals.items.map((db) => <RailItem key={db.id} db={db} selected={db.id === selId} onSelect={() => selectDb(db.id)} />)}
              </div>
            )}
          </aside>

          {/* ── Right pane: selected DB detail + moderation ── */}
          <main class="flex-1 min-w-0 md:h-full overflow-y-auto">
            {sel ? <DetailPane db={sel} /> : (
              <div class="h-full flex items-center justify-center text-[12px] text-[var(--color-text-faint)]">Select a database from the left.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
