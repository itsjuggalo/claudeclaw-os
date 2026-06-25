import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Database, RefreshCw, ChevronRight, ChevronDown, Play, AlertTriangle, Table2, Pencil, Trash2, Plus, Undo2, Shield, ShieldCheck, X, History } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiGet, apiPost } from '@/lib/api';
import { formatRelativeTime, formatNumber } from '@/lib/format';

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

// ── Confirm modal (typed-confirm for destructive actions) ─────────────
function ConfirmModal({ title, destructive, requireWord, body, busy, err, onCancel, onConfirm }: {
  title: string; destructive?: boolean; requireWord?: string;
  body: ComponentChildren; busy: boolean; err: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !requireWord || typed.trim().toLowerCase() === requireWord.toLowerCase();
  return (
    <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onClick={onCancel}>
      <div class="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div class="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text)]">
            {destructive && <AlertTriangle size={15} class="text-[var(--color-status-failed)]" />} {title}
          </div>
          <button type="button" onClick={onCancel} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={15} /></button>
        </div>
        <div class="px-4 py-3 max-h-[50vh] overflow-y-auto text-[12px] text-[var(--color-text-muted)]">{body}</div>
        {requireWord && (
          <div class="px-4 pb-1">
            <div class="text-[11px] text-[var(--color-text-faint)] mb-1">Type <span class="font-mono font-semibold text-[var(--color-status-failed)]">{requireWord}</span> to confirm</div>
            <input value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} spellcheck={false}
              class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] font-mono text-[var(--color-text)]" />
          </div>
        )}
        {err && <div class="mx-4 mb-2 rounded-md border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-status-failed)]">{err}</div>}
        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button type="button" onClick={onCancel} class="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy || !ok}
            class="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            style={`background:${destructive ? 'var(--color-status-failed)' : 'var(--color-accent)'}`}>
            {busy ? 'Working…' : destructive ? 'Confirm delete' : 'Save'}
          </button>
        </div>
      </div>
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
    const values: Record<string, unknown> = {};
    cols.forEach((c) => { const v = draftValue(c); if (!(v == null && draft[c].isNull && draft[c].v === '')) values[c] = v; });
    // include only columns the user set (non-null OR explicitly typed); drop untouched all-null blanks
    const provided: Record<string, unknown> = {};
    cols.forEach((c) => { if (!draft[c].isNull || draft[c].v !== '') provided[c] = draftValue(c); });
    setCErr(null);
    setConfirm({
      kind: 'insert', values: Object.keys(provided).length ? provided : values,
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
          <div class="mb-2 text-[var(--color-status-failed)] font-medium">This permanently deletes a row from <span class="font-mono">{table}</span>. A backup + before-image is saved (undoable from the history below).</div>
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
    <div class="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-bg)]">
      <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <div class="flex items-center gap-2 text-[12px] font-medium text-[var(--color-text)]">
          <Table2 size={13} class="text-[var(--color-accent)]" /> <span class="font-mono">{table}</span>
          {data && <span class="text-[var(--color-text-faint)] tabular-nums">· {formatNumber(data.total)} rows</span>}
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onClick={startInsert} disabled={!data || editing === 'NEW'}
            class="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40" style="background:var(--color-accent)">
            <Plus size={11} /> Add row
          </button>
          <button type="button" onClick={onClose} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]" title="Close"><X size={14} /></button>
        </div>
      </div>

      {loading && !data && <div class="px-3 py-2 text-[11px] text-[var(--color-text-faint)]">Loading rows…</div>}
      {err && <div class="px-3 py-2 text-[11px] font-mono text-[var(--color-status-failed)]">{err}</div>}

      {data && (
        <div class="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table class="w-full text-[11px]">
            <thead class="bg-[var(--color-elevated)] border-b border-[var(--color-border)] text-left sticky top-0 z-10">
              <tr>
                <th class="px-2 py-1.5 w-[72px]"></th>
                {cols.map((c) => <th key={c} class="px-2.5 py-1.5 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] whitespace-nowrap">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {editing === 'NEW' && (
                <tr class="border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]">
                  <td class="px-2 py-1 align-top">
                    <div class="flex gap-1">
                      <button type="button" onClick={askInsert} title="Save new row" class="text-[var(--color-status-done)] hover:opacity-80"><Plus size={13} /></button>
                      <button type="button" onClick={() => setEditing(null)} title="Cancel" class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={13} /></button>
                    </div>
                  </td>
                  {cols.map((c) => <td key={c} class="px-1 py-1 align-top">{cellEditor(c, draft, setDraft)}</td>)}
                </tr>
              )}
              {data.rows.map((row) => {
                const ks = keyStr(row.__key);
                const isEd = editing === ks;
                return (
                  <tr key={ks} class={`border-b border-[var(--color-border)] last:border-0 ${isEd ? 'bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]' : 'hover:bg-[var(--color-elevated)]'}`}>
                    <td class="px-2 py-1 align-top whitespace-nowrap">
                      {isEd ? (
                        <div class="flex gap-1">
                          <button type="button" onClick={() => askSaveEdit(row)} title="Save" class="text-[var(--color-status-done)] hover:opacity-80"><Pencil size={13} /></button>
                          <button type="button" onClick={() => setEditing(null)} title="Cancel" class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={13} /></button>
                        </div>
                      ) : (
                        <div class="flex gap-1.5">
                          <button type="button" onClick={() => startEdit(row.__key, row.cells)} title="Edit row" class="text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"><Pencil size={13} /></button>
                          <button type="button" onClick={() => askDelete(row)} title="Delete row" class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)]"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                    {row.cells.map((cell, ci) => (
                      <td key={ci} class="px-1 py-1 align-top">
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
        <div class="flex items-center justify-between px-3 py-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)] tabular-nums">
          <span>rows {offset + 1}–{offset + data.rows.length} of {formatNumber(data.total)}</span>
          <div class="flex gap-2">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))} class="rounded px-2 py-0.5 border border-[var(--color-border)] disabled:opacity-30 hover:text-[var(--color-text)]">‹ prev</button>
            <button type="button" disabled={!data.capped} onClick={() => setOffset(offset + 200)} class="rounded px-2 py-0.5 border border-[var(--color-border)] disabled:opacity-30 hover:text-[var(--color-text)]">next ›</button>
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

// One editable cell: text input + a "null" toggle.
function cellEditor(col: string, draft: Record<string, { v: string; isNull: boolean }>, setDraft: (f: (d: Record<string, { v: string; isNull: boolean }>) => Record<string, { v: string; isNull: boolean }>) => void) {
  const d = draft[col];
  if (!d) return null;
  return (
    <div class="flex items-center gap-1 min-w-[120px]">
      <input value={d.v} disabled={d.isNull} spellcheck={false}
        onInput={(e) => { const v = (e.target as HTMLInputElement).value; setDraft((p) => ({ ...p, [col]: { v, isNull: false } })); }}
        class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-[11px] font-mono text-[var(--color-text)] disabled:opacity-40" />
      <button type="button" title="set NULL" onClick={() => setDraft((p) => ({ ...p, [col]: { v: d.isNull ? '' : p[col].v, isNull: !d.isNull } }))}
        class={`shrink-0 rounded px-1 py-0.5 text-[9px] font-mono border ${d.isNull ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-faint)]'}`}>∅</button>
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
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border)] text-[11px] font-medium text-[var(--color-text-muted)]">
        <History size={12} /> Change history <span class="text-[var(--color-text-faint)] font-normal">({entries.length})</span>
      </div>
      {err && <div class="px-3 py-1.5 text-[11px] font-mono text-[var(--color-status-failed)]">{err}</div>}
      <div class="max-h-[220px] overflow-y-auto divide-y divide-[var(--color-border)]">
        {entries.map((m) => {
          const color = m.action.startsWith('undo') ? 'var(--color-text-faint)' : m.action === 'delete' ? 'var(--color-status-failed)' : m.action === 'insert' ? 'var(--color-status-done)' : 'var(--color-accent)';
          return (
            <div key={m.id} class="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
              <div class="min-w-0 flex items-center gap-2">
                <span class="font-semibold uppercase tabular-nums" style={`color:${color}`}>{m.action}</span>
                <span class="font-mono text-[var(--color-text-muted)] truncate">{m.tbl}</span>
                <span class="text-[var(--color-text-faint)] truncate">{m.row_key}</span>
                <span class="text-[var(--color-text-faint)] whitespace-nowrap">{agoFromIso(m.ts)}</span>
              </div>
              {m.undone_at ? <span class="text-[10px] text-[var(--color-text-faint)] italic whitespace-nowrap">undone</span>
                : !m.action.startsWith('undo') && (
                  <button type="button" disabled={busy === m.id} onClick={() => undo(m.id)}
                    class="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] disabled:opacity-40">
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

// ── One DB's expandable detail: tables + (read) query + (write) moderation ──
function DbDetail({ db }: { db: SqlDbInfo }) {
  const { data, loading, error } = useFetch<SqlTablesResult | { error: string }>(`/api/sql/${db.id}/meta`, 0);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<SqlSelectResult | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modTable, setModTable] = useState<string | null>(null);
  const [auditKey, setAuditKey] = useState(0);

  const meta = data && !('error' in data) ? data : null;
  const metaErr = data && 'error' in data ? data.error : error;

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
    <div class="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-3 space-y-3">
      {loading && !meta && <div class="text-[11px] text-[var(--color-text-faint)]">Loading tables…</div>}
      {metaErr && <div class="text-[11px] text-[var(--color-status-failed)] font-mono">{metaErr}</div>}

      {meta && (
        <>
          {/* Tables — on a writable DB, a chip opens the editable grid; else it browses (read-only). */}
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">
              Tables ({meta.tables.length}){db.writable && <span class="ml-1 text-[var(--color-accent)] normal-case tracking-normal">— click to moderate</span>}
            </div>
            {meta.tables.length === 0 ? (
              <div class="text-[11px] text-[var(--color-text-faint)]">No user tables.</div>
            ) : (
              <div class="flex flex-wrap gap-1.5">
                {meta.tables.map((t) => (
                  <button key={t.name} type="button"
                    onClick={() => (db.writable ? setModTable(modTable === t.name ? null : t.name) : run(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 100`))}
                    title={db.writable ? `Moderate ${t.name}` : `Browse ${t.name}`}
                    class={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${modTable === t.name ? 'border-[var(--color-accent)] text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'border-[var(--color-border)] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]'}`}>
                    <Table2 size={11} class="opacity-60" />
                    <span class="font-mono">{t.name}</span>
                    <span class="tabular-nums text-[var(--color-text-faint)]">{t.rows < 0 ? '?' : formatNumber(t.rows)}</span>
                  </button>
                ))}
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
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Query (SELECT-only)</div>
              <button type="button" onClick={() => run()} disabled={running || !sql.trim()}
                class="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
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
              class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-[12px] font-mono text-[var(--color-text)] resize-y" />
          </div>

          {qErr && (
            <div class="rounded-md border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-status-failed)]">
              {qErr}
            </div>
          )}

          {result && (
            <div>
              <div class="text-[10px] text-[var(--color-text-faint)] mb-1 tabular-nums">
                {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · {result.elapsed_ms}ms
                {result.capped && <span class="text-[var(--color-warn)]"> · capped at 500</span>}
              </div>
              <div class="overflow-x-auto rounded-md border border-[var(--color-border)] max-h-[360px] overflow-y-auto">
                <table class="w-full text-[11px]">
                  <thead class="bg-[var(--color-elevated)] border-b border-[var(--color-border)] text-left sticky top-0">
                    <tr>
                      {result.columns.map((c, i) => (
                        <th key={i} class="px-2.5 py-1.5 font-medium text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri} class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-elevated)]">
                        {row.map((cell, ci) => (
                          <td key={ci} class="px-2.5 py-1.5 font-mono text-[var(--color-text-muted)] whitespace-nowrap max-w-[420px] truncate"
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

function DbCard({ db }: { db: SqlDbInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        class="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--color-elevated)] transition-colors">
        {open ? <ChevronDown size={14} class="text-[var(--color-text-faint)] shrink-0" /> : <ChevronRight size={14} class="text-[var(--color-text-faint)] shrink-0" />}
        <Database size={15} class="text-[var(--color-accent)] shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-medium text-[var(--color-text)] truncate">{db.label}</span>
            {db.writable ? (
              <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                style="color:var(--color-accent);background:color-mix(in srgb,var(--color-accent) 14%,transparent)">
                <ShieldCheck size={10} /> moderate
              </span>
            ) : (
              <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-[var(--color-text-faint)]"
                style="background:color-mix(in srgb,var(--color-text-faint) 12%,transparent)">
                <Shield size={10} /> read-only
              </span>
            )}
            {db.stale && (
              <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                style="color:var(--color-warn);background:color-mix(in srgb,var(--color-warn) 14%,transparent)">
                <AlertTriangle size={10} /> stale
              </span>
            )}
            {db.live && !db.stale && (
              <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                style="color:var(--color-status-done);background:color-mix(in srgb,var(--color-status-done) 14%,transparent)">live</span>
            )}
          </div>
          {db.subtitle && <div class="text-[10px] text-[var(--color-text-faint)] truncate">{db.subtitle}</div>}
        </div>
        <div class="flex items-center gap-4 text-[11px] text-[var(--color-text-muted)] tabular-nums shrink-0">
          <span title="size on disk">{db.size}{db.walSize && <span class="text-[var(--color-text-faint)]"> +{db.walSize} wal</span>}</span>
          <span class="hidden sm:inline" title="tables">{db.tables < 0 ? '—' : db.tables} {db.tables === 1 ? 'table' : 'tables'}</span>
          <span class="hidden md:inline text-[var(--color-text-faint)]" title={db.updated || ''}>{agoFromIso(db.updated)}</span>
        </div>
      </button>
      {open && <DbDetail db={db} />}
    </div>
  );
}

export function SqlMonitor() {
  const { data, loading, error, refresh } = useFetch<SqlCatalog>('/api/sql', 30000);
  const [showInternals, setShowInternals] = useState(false);

  const groups = data?.groups ?? [];
  const mainGroups = groups.filter((g) => g.id !== 'internals');
  const internals = groups.find((g) => g.id === 'internals');
  const writableCount = groups.flatMap((g) => g.items).filter((d) => d.writable).length;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="SQL Monitor"
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
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <p class="text-[11px] text-[var(--color-text-faint)] leading-snug">
            Every operational SQLite DB on the box, kept separate and organized. Click a DB to browse its tables and run
            SELECT-only queries.{' '}
            {writableCount > 0 && (
              <>
                <span class="text-[var(--color-accent)] font-medium">{writableCount} app DB{writableCount === 1 ? '' : 's'}</span> are
                flagged <span class="font-medium text-[var(--color-accent)]">moderate</span> — there you can edit/delete/add rows;
                every write is confirmed, auto-backed-up, and logged with one-click undo. All other DBs are strictly read-only.
              </>
            )}
          </p>

          {mainGroups.map((g) => (
            <section key={g.id}>
              <h2 class="text-[12px] font-semibold text-[var(--color-text-muted)] mb-2">
                {g.label} <span class="text-[var(--color-text-faint)]">({g.items.length})</span>
              </h2>
              <div class="space-y-2">
                {g.items.map((db) => <DbCard key={db.id} db={db} />)}
              </div>
            </section>
          ))}

          {internals && internals.items.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowInternals((s) => !s)}
                class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-2">
                {showInternals ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Internals <span class="text-[var(--color-text-faint)] font-normal">({internals.items.length}) — agent memory, watchdog, tools with their own UI</span>
              </button>
              {showInternals && (
                <div class="space-y-2">
                  {internals.items.map((db) => <DbCard key={db.id} db={db} />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
