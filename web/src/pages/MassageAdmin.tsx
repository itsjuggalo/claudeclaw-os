import { useEffect, useMemo, useState } from 'preact/hooks';
import { Link } from 'wouter-preact';
import {
  ClipboardList,
  LockKeyhole,
  Mail,
  MessageSquareText,
  CalendarClock,
  Percent,
  FileText,
  UserRound,
  ShieldAlert,
  Database,
  Table2,
  History,
  RefreshCw,
  HardDrive,
  Clock,
  ShieldCheck,
  ExternalLink,
  Pencil,
  Trash2,
  Plus,
  X,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiGet, apiPost } from '@/lib/api';
import { formatNumber, formatRelativeTime } from '@/lib/format';

interface AdminSection {
  title: string;
  description: string;
  icon: typeof ClipboardList;
  status: string;
}

interface SqlDbInfo {
  id: string;
  label: string;
  subtitle?: string;
  group: string;
  size: string;
  bytes: number;
  tables: number;
  walSize: string;
  updated: string | null;
  live: boolean;
  stale: boolean;
  infra: boolean;
  writable: boolean;
}

interface SqlCatalogGroup {
  id: string;
  label: string;
  items: SqlDbInfo[];
}

interface SqlCatalog {
  groups: SqlCatalogGroup[];
  totalBytes: number;
  generatedAt: number;
}

interface SqlTablesResult {
  id: string;
  label: string;
  size: string;
  updated: string | null;
  tables: Array<{ name: string; rows: number }>;
}

interface AuditEntry {
  id: number;
  ts: string;
  db_id: string;
  db_label: string | null;
  tbl: string;
  action: string;
  row_key: string | null;
  undone_at: string | null;
}

type RowKey = { rowid?: number | string; pk?: Record<string, unknown> };

interface ModRowsResult {
  id: string;
  label: string;
  table: string;
  writable: boolean;
  columns: string[];
  hasRowid: boolean;
  pkCols: string[];
  rows: Array<{ __key: RowKey; cells: unknown[] }>;
  total: number;
  offset: number;
  capped: boolean;
}

const sections: AdminSection[] = [
  {
    title: 'Massage clients',
    description: 'Client list placeholder for future read-only search and lifecycle summaries.',
    icon: UserRound,
    status: 'Not connected',
  },
  {
    title: 'Client profile/details',
    description: 'Profile, booking history, preferences, and consent indicators will live here after an approved API design.',
    icon: FileText,
    status: 'Placeholder',
  },
  {
    title: 'Free next-visit enhancements',
    description: 'Future admin workflow for recording approved complimentary enhancements without exposing raw database writes.',
    icon: ClipboardList,
    status: 'Planned',
  },
  {
    title: 'Notes',
    description: 'Private admin notes are intentionally not wired until storage, audit, and access rules are reviewed.',
    icon: FileText,
    status: 'Planned',
  },
  {
    title: 'Email consent',
    description: 'Marketing email tools must require explicit opt-in consent before any campaign or individual send.',
    icon: Mail,
    status: 'Consent required',
  },
  {
    title: 'SMS/text consent',
    description: 'SMS workflows must require explicit text-message opt-in consent before any outreach.',
    icon: MessageSquareText,
    status: 'Consent required',
  },
  {
    title: 'Schedule availability updates',
    description: 'Availability notices can be designed later as opt-in communications with preview and audit logging.',
    icon: CalendarClock,
    status: 'Planned',
  },
  {
    title: 'Seasonal discount campaigns',
    description: 'Campaign tooling is blocked until audience consent filtering, approvals, and send limits exist.',
    icon: Percent,
    status: 'Blocked by consent',
  },
  {
    title: 'Admin action log',
    description: 'Future audit trail for every admin mutation, export, consent change, and communication action.',
    icon: LockKeyhole,
    status: 'Required before launch',
  },
];

function StatusPill({ label }: { label: string }) {
  return (
    <span class="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-elevated)] border border-[var(--color-border)]">
      {label}
    </span>
  );
}

const agoFromIso = (iso: string | null) => (iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : '-');
const rowsLabel = (rows: number) => (rows < 0 ? '?' : formatNumber(rows));
const cellStr = (value: unknown) => (value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
const keyStr = (key: RowKey) => (key.rowid != null ? `r:${key.rowid}` : `pk:${JSON.stringify(key.pk || {})}`);

function InfoStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Database }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3.5 py-2.5">
      <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
        <Icon size={11} />
        {label}
      </div>
      <div class="mt-1 text-[18px] font-semibold tabular-nums text-[var(--color-text)]">{value}</div>
    </div>
  );
}

function CellEditor({
  column,
  draft,
  setDraft,
}: {
  column: string;
  draft: Record<string, { v: string; isNull: boolean }>;
  setDraft: (next: Record<string, { v: string; isNull: boolean }>) => void;
}) {
  const current = draft[column];
  if (!current) return null;
  return (
    <div class="flex min-w-[150px] items-center gap-1">
      <input
        value={current.v}
        disabled={current.isNull}
        spellcheck={false}
        onInput={(event) => setDraft({ ...draft, [column]: { v: (event.currentTarget as HTMLInputElement).value, isNull: false } })}
        class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-[11px] font-mono text-[var(--color-text)] outline-none disabled:opacity-40 focus:border-[var(--color-accent)]"
      />
      <button
        type="button"
        title="Toggle NULL"
        onClick={() => setDraft({ ...draft, [column]: { v: current.v, isNull: !current.isNull } })}
        class={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-mono ${
          current.isNull
            ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
            : 'border-[var(--color-border)] text-[var(--color-text-faint)]'
        }`}
      >
        NULL
      </button>
    </div>
  );
}

function MassageTableEditor({ table, onChanged }: { table: string; onChanged: () => void }) {
  const [data, setData] = useState<ModRowsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { v: string; isNull: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<ModRowsResult | { error: string }>(`/api/sql/massage/rows?table=${encodeURIComponent(table)}&offset=${offset}`);
      if ('error' in result) {
        setError(result.error);
        setData(null);
      } else {
        setData(result);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOffset(0);
    setEditing(null);
    setDraft({});
    setMessage(null);
  }, [table]);

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, offset]);

  const columns = data?.columns ?? [];

  function seedDraft(cells?: unknown[]) {
    const next: Record<string, { v: string; isNull: boolean }> = {};
    columns.forEach((column, index) => {
      const value = cells ? cells[index] : null;
      next[column] = { v: cellStr(value), isNull: value == null };
    });
    setDraft(next);
  }

  function startEdit(row: { __key: RowKey; cells: unknown[] }) {
    setEditing(keyStr(row.__key));
    seedDraft(row.cells);
    setMessage(null);
  }

  function startInsert() {
    setEditing('NEW');
    seedDraft();
    setMessage(null);
  }

  const draftValue = (column: string): unknown => (draft[column]?.isNull ? null : draft[column]?.v ?? '');

  async function saveEdit(row: { __key: RowKey; cells: unknown[] }) {
    const changes: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      const before = row.cells[index];
      const after = draftValue(column);
      const changed = (before == null) !== (after == null) || (before != null && String(before) !== String(after));
      if (changed) changes[column] = after;
    });
    if (!Object.keys(changes).length) {
      setEditing(null);
      return;
    }
    if (!window.confirm(`Save ${Object.keys(changes).length} change(s) to ${table}?`)) return;
    setBusy(keyStr(row.__key));
    setMessage(null);
    try {
      const result = await apiPost<{ ok?: true; error?: string }>('/api/sql/massage/row/update', { table, key: row.__key, changes });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(null);
      setMessage('Saved changes.');
      await loadRows();
      onChanged();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  async function insertRow() {
    const values: Record<string, unknown> = {};
    columns.forEach((column) => {
      const current = draft[column];
      if (!current) return;
      if (!current.isNull || current.v !== '') values[column] = draftValue(column);
    });
    if (!window.confirm(`Insert a new row into ${table}?`)) return;
    setBusy('NEW');
    setMessage(null);
    try {
      const result = await apiPost<{ ok?: true; error?: string }>('/api/sql/massage/row/insert', { table, values });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(null);
      setMessage('Inserted row.');
      await loadRows();
      onChanged();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteRow(row: { __key: RowKey }) {
    const typed = window.prompt(`Delete one row from ${table}? Type DELETE to confirm.`);
    if (typed !== 'DELETE') return;
    setBusy(keyStr(row.__key));
    setMessage(null);
    try {
      const result = await apiPost<{ ok?: true; error?: string }>('/api/sql/massage/row/delete', { table, key: row.__key });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage('Deleted row.');
      await loadRows();
      onChanged();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-border))] bg-[var(--color-bg)]">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text)]">
            <Pencil size={13} class="text-[var(--color-accent)]" />
            Editing <span class="font-mono">{table}</span>
            {data && <span class="font-mono font-normal text-[var(--color-text-faint)]">{formatNumber(data.total)} rows</span>}
          </div>
          <div class="mt-0.5 text-[10px] text-[var(--color-text-faint)]">
            Writes are backed up and logged by SQL Monitor. Email and SMS sending stay disconnected.
          </div>
        </div>
        <button
          type="button"
          onClick={startInsert}
          disabled={!data || editing === 'NEW'}
          class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
          style="background:var(--color-accent)"
        >
          <Plus size={12} />
          Add row
        </button>
      </div>

      {message && <div class="border-b border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-status-done)]">{message}</div>}
      {error && <div class="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-mono text-[var(--color-status-failed)]">{error}</div>}
      {loading && !data && <div class="px-3 py-3 text-[12px] text-[var(--color-text-faint)]">Loading editable rows...</div>}

      {data && (
        <>
          <div class="max-h-[520px] overflow-auto">
            <table class="w-full min-w-[760px] text-[11px]">
              <thead class="sticky top-0 z-10 bg-[var(--color-elevated)] text-left">
                <tr>
                  <th class="w-[96px] border-b border-[var(--color-border)] px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Actions</th>
                  {columns.map((column) => (
                    <th key={column} class="border-b border-[var(--color-border)] px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editing === 'NEW' && (
                  <tr class="bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]">
                    <td class="border-b border-[var(--color-border)] px-2 py-1 align-top">
                      <div class="flex items-center gap-1">
                        <button type="button" title="Insert row" onClick={insertRow} disabled={busy === 'NEW'} class="text-[var(--color-status-done)] disabled:opacity-40">
                          <Plus size={14} />
                        </button>
                        <button type="button" title="Cancel" onClick={() => setEditing(null)} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                    {columns.map((column) => (
                      <td key={column} class="border-b border-[var(--color-border)] px-1 py-1 align-top">
                        <CellEditor column={column} draft={draft} setDraft={setDraft} />
                      </td>
                    ))}
                  </tr>
                )}
                {data.rows.map((row) => {
                  const rowKey = keyStr(row.__key);
                  const isEditing = editing === rowKey;
                  return (
                    <tr key={rowKey} class={isEditing ? 'bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]' : 'hover:bg-[var(--color-elevated)]'}>
                      <td class="border-b border-[var(--color-border)] px-2 py-1 align-top">
                        {isEditing ? (
                          <div class="flex items-center gap-1">
                            <button type="button" title="Save changes" onClick={() => saveEdit(row)} disabled={busy === rowKey} class="text-[var(--color-status-done)] disabled:opacity-40">
                              <Pencil size={14} />
                            </button>
                            <button type="button" title="Cancel" onClick={() => setEditing(null)} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div class="flex items-center gap-1.5">
                            <button type="button" title="Edit row" onClick={() => startEdit(row)} class="text-[var(--color-text-faint)] hover:text-[var(--color-accent)]">
                              <Pencil size={13} />
                            </button>
                            <button type="button" title="Delete row" onClick={() => deleteRow(row)} disabled={busy === rowKey} class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)] disabled:opacity-40">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                      {row.cells.map((cell, index) => (
                        <td key={columns[index]} class="border-b border-[var(--color-border)] px-1 py-1 align-top">
                          {isEditing ? (
                            <CellEditor column={columns[index]} draft={draft} setDraft={setDraft} />
                          ) : (
                            <span class="block max-w-[320px] truncate px-1.5 font-mono text-[var(--color-text-muted)]" title={cellStr(cell)}>
                              {cell == null ? <span class="italic text-[var(--color-text-faint)]">null</span> : cellStr(cell)}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(offset > 0 || data.capped) && (
            <div class="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-faint)]">
              <span class="font-mono">rows {offset + 1}-{offset + data.rows.length} of {formatNumber(data.total)}</span>
              <div class="flex items-center gap-2">
                <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))} class="rounded-md border border-[var(--color-border)] px-2 py-0.5 disabled:opacity-30 hover:text-[var(--color-text)]">
                  prev
                </button>
                <button type="button" disabled={!data.capped} onClick={() => setOffset(offset + 200)} class="rounded-md border border-[var(--color-border)] px-2 py-0.5 disabled:opacity-30 hover:text-[var(--color-text)]">
                  next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MassageSqlPanel() {
  const catalog = useFetch<SqlCatalog>('/api/sql', 30000);
  const massageDb = useMemo(
    () => catalog.data?.groups.flatMap((group) => group.items).find((db) => db.id === 'massage') ?? null,
    [catalog.data],
  );
  const meta = useFetch<SqlTablesResult | { error: string }>(massageDb ? '/api/sql/massage/meta' : null, 30000);
  const audit = useFetch<{ entries: AuditEntry[] }>(massageDb ? '/api/sql/audit?db=massage&limit=8' : null, 30000);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const tableData = meta.data && !('error' in meta.data) ? meta.data : null;
  const metaError = meta.data && 'error' in meta.data ? meta.data.error : meta.error;
  const entries = audit.data?.entries ?? [];
  const tables = tableData?.tables ?? [];

  useEffect(() => {
    if (!selectedTable) return;
    if (tableData && !tableData.tables.some((table) => table.name === selectedTable)) setSelectedTable(null);
  }, [selectedTable, tableData]);

  function refreshSqlData() {
    catalog.refresh();
    meta.refresh();
    audit.refresh();
  }

  return (
    <section class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <Database size={17} class="text-[var(--color-accent)]" />
            <h2 class="text-[13px] font-semibold text-[var(--color-text)]">Massage SQL database</h2>
            {massageDb?.writable && (
              <span
                class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]"
                style="background:color-mix(in srgb,var(--color-accent) 14%,transparent)"
              >
                <ShieldCheck size={10} />
                SQL Monitor moderatable
              </span>
            )}
          </div>
          <p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            Summary and editing use the existing SQL Monitor registry. Row changes go through guarded endpoints with backups and audit logging.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshSqlData}
            class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <RefreshCw size={12} />
            refresh
          </button>
          <Link
            href="/sql-monitor"
            class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
            style="background:var(--color-accent)"
          >
            <ExternalLink size={12} />
            SQL Monitor
          </Link>
        </div>
      </div>

      {catalog.error && <div class="mt-3"><PageState error={catalog.error} /></div>}
      {catalog.loading && !catalog.data && <div class="mt-3"><PageState loading /></div>}

      {catalog.data && !massageDb && (
        <div class="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
          SQL Monitor did not find the registered <span class="font-mono">massage</span> database on disk.
        </div>
      )}

      {massageDb && (
        <div class="mt-4 space-y-4">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoStat label="Registry ID" value={massageDb.id} icon={Database} />
            <InfoStat label="Tables" value={massageDb.tables < 0 ? '-' : massageDb.tables} icon={Table2} />
            <InfoStat label="Size" value={massageDb.walSize ? `${massageDb.size} + ${massageDb.walSize}` : massageDb.size} icon={HardDrive} />
            <InfoStat label="Last write" value={agoFromIso(massageDb.updated)} icon={Clock} />
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
            <div>
              <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
                Tables {tableData && <span class="font-mono font-normal">({tableData.tables.length})</span>}
              </div>
              {meta.loading && !tableData && <div class="text-[12px] text-[var(--color-text-faint)]">Loading tables...</div>}
              {metaError && <div class="text-[12px] font-mono text-[var(--color-status-failed)]">{metaError}</div>}
              {tableData && (
                <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
                  <table class="w-full text-[12px]">
                    <thead class="bg-[var(--color-elevated)] text-left">
                      <tr>
                        <th class="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Table</th>
                        <th class="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tables.map((table) => (
                        <tr key={table.name} class="border-t border-[var(--color-border)]">
                          <td class="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setSelectedTable(selectedTable === table.name ? null : table.name)}
                              class={`font-mono ${selectedTable === table.name ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)] hover:text-[var(--color-accent)]'}`}
                            >
                              {table.name}
                            </button>
                          </td>
                          <td class="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-text-muted)]">{rowsLabel(table.rows)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <div class="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
                <History size={11} />
                Recent admin action log
              </div>
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                {audit.error && <div class="px-3 py-2 text-[11px] font-mono text-[var(--color-status-failed)]">{audit.error}</div>}
                {!audit.error && entries.length === 0 && (
                  <div class="px-3 py-5 text-center text-[12px] text-[var(--color-text-faint)]">No SQL Monitor mutations logged for massage.</div>
                )}
                {entries.map((entry) => (
                  <div key={entry.id} class="flex items-center justify-between gap-2 border-t first:border-t-0 border-[var(--color-border)] px-3 py-2 text-[11px]">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-mono font-semibold uppercase text-[var(--color-accent)]">{entry.action}</span>
                        <span class="font-mono text-[var(--color-text-muted)] truncate">{entry.tbl}</span>
                      </div>
                      <div class="mt-0.5 max-w-[240px] truncate font-mono text-[var(--color-text-faint)]">{entry.row_key || '-'}</div>
                    </div>
                    <div class="shrink-0 text-right text-[var(--color-text-faint)]">
                      <div>{agoFromIso(entry.ts)}</div>
                      {entry.undone_at && <div class="italic">undone</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {selectedTable && (
            <MassageTableEditor
              table={selectedTable}
              onChanged={refreshSqlData}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function MassageAdmin() {
  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Massage Admin"
        actions={
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warn)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-warn)]"
            style="background:color-mix(in srgb,var(--color-warn) 12%,transparent)"
          >
            <ShieldAlert size={13} />
            Admin-only placeholder
          </span>
        }
      />

      <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <section class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] px-4 py-3">
          <div class="flex flex-wrap items-start gap-3">
            <LockKeyhole size={18} class="mt-0.5 text-[var(--color-accent)]" />
            <div class="min-w-0 flex-1">
              <h2 class="text-[13px] font-semibold text-[var(--color-text)]">Protected dashboard area</h2>
              <p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                This page is behind the existing ClaudeClaw dashboard access gate, but no separate admin role check was found.
                TODO: add real admin role enforcement before connecting client data, database mutations, email, or SMS tools.
              </p>
              <p class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-faint)]">
                No email or SMS sending is connected. Future marketing messages must require explicit opt-in consent.
              </p>
            </div>
          </div>
        </section>

        <MassageSqlPanel />

        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <article key={section.title} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
                <div class="flex items-start gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-accent)]">
                    <Icon size={17} />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <h3 class="text-[13px] font-semibold text-[var(--color-text)]">{section.title}</h3>
                      <StatusPill label={section.status} />
                    </div>
                    <p class="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{section.description}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
