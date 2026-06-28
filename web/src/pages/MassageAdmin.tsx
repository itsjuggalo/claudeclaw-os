import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  CalendarClock,
  Check,
  History,
  LockKeyhole,
  Mail,
  MessageSquareText,
  RefreshCw,
  Save,
  ShieldAlert,
  UserRound,
  X,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPatch } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

interface MigrationState {
  required: boolean;
  missingUserColumns: string[];
  missingTables: string[];
  sqlFile: string;
}

interface MassageClient {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  nextVisitFreeEnhancement: string;
  enhancementExpirationDate: string;
  emailOptIn: boolean;
  smsOptIn: boolean;
  accountStatus: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  appointmentCount: number;
  upcomingAppointmentCount: number;
}

interface AdminAction {
  id: number;
  adminUser: string;
  clientId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string;
}

interface Overview {
  dbPath: string;
  migration: MigrationState;
  clients: MassageClient[];
  actionLog: AdminAction[];
}

interface AdminSession {
  canEdit: boolean;
  adminUser: string | null;
  reason: string | null;
  roleTodo: string;
}

type Draft = Pick<
  MassageClient,
  | 'name'
  | 'phone'
  | 'email'
  | 'notes'
  | 'nextVisitFreeEnhancement'
  | 'enhancementExpirationDate'
  | 'emailOptIn'
  | 'smsOptIn'
  | 'accountStatus'
>;

const agoFromIso = (iso: string | null) => (iso ? formatRelativeTime(Math.floor(Date.parse(iso) / 1000)) : '-');

function toDraft(client: MassageClient): Draft {
  return {
    name: client.name,
    phone: client.phone,
    email: client.email,
    notes: client.notes,
    nextVisitFreeEnhancement: client.nextVisitFreeEnhancement,
    enhancementExpirationDate: client.enhancementExpirationDate,
    emailOptIn: client.emailOptIn,
    smsOptIn: client.smsOptIn,
    accountStatus: client.accountStatus || 'active',
  };
}

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <label class="block">
      <div class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      {children}
    </label>
  );
}

const inputClass = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60';

export function MassageAdmin() {
  const overview = useFetch<Overview>('/api/massage-admin/clients', 30000);
  const session = useFetch<AdminSession>('/api/massage-admin/session', 30000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const clients = overview.data?.clients ?? [];
  const selected = useMemo(
    () => clients.find((client) => client.id === selectedId) ?? clients[0] ?? null,
    [clients, selectedId],
  );
  const migration = overview.data?.migration;
  const canEdit = Boolean(session.data?.canEdit && !migration?.required);

  useEffect(() => {
    if (!selectedId && clients[0]) setSelectedId(clients[0].id);
  }, [clients, selectedId]);

  useEffect(() => {
    if (selected) {
      setDraft(toDraft(selected));
      setEditing(false);
      setSaveError(null);
      setSaveMessage(null);
    }
  }, [selected?.id]);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!selected || !draft || !canEdit) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const result = await apiPatch<{ ok?: true; changed?: number; error?: string; migration?: MigrationState }>(
        `/api/massage-admin/clients/${encodeURIComponent(selected.id)}`,
        draft,
      );
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setSaveMessage(`Saved ${result.changed ?? 0} field change${result.changed === 1 ? '' : 's'}.`);
      setEditing(false);
      overview.refresh();
    } catch (err: any) {
      const body = err?.body as { error?: string } | undefined;
      setSaveError(body?.error || err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Massage Admin"
        actions={
          <button
            type="button"
            onClick={() => {
              overview.refresh();
              session.refresh();
            }}
            class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <RefreshCw size={12} />
            refresh
          </button>
        }
      />

      {overview.error && <PageState error={overview.error} />}
      {overview.loading && !overview.data && <PageState loading />}

      {overview.data && (
        <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <section class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] px-4 py-3">
            <div class="flex flex-wrap items-start gap-3">
              <LockKeyhole size={18} class="mt-0.5 text-[var(--color-accent)]" />
              <div class="min-w-0 flex-1">
                <h2 class="text-[13px] font-semibold text-[var(--color-text)]">Admin-protected editing</h2>
                <p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  Writes require a loopback request or an existing master `mc_access` session. Real per-user admin roles are still a TODO.
                </p>
                {!session.data?.canEdit && (
                  <p class="mt-2 text-[11px] text-[var(--color-warn)]">{session.data?.reason || session.error || 'Editing is disabled for this session.'}</p>
                )}
                <p class="mt-2 text-[11px] text-[var(--color-text-faint)]">
                  No email or SMS sending is connected. Marketing messages still require explicit opt-in consent.
                </p>
              </div>
            </div>
          </section>

          {migration?.required && (
            <section class="mb-4 rounded-lg border border-[var(--color-warn)] px-4 py-3 text-[12px] text-[var(--color-warn)]">
              <div class="flex items-start gap-2">
                <ShieldAlert size={16} class="mt-0.5 shrink-0" />
                <div>
                  <div class="font-semibold">Migration required before editing</div>
                  <div class="mt-1 text-[var(--color-text-muted)]">
                    Run review first, then apply <span class="font-mono">{migration.sqlFile}</span> to the massage database.
                    Missing columns: {migration.missingUserColumns.join(', ') || 'none'}.
                    Missing tables: {migration.missingTables.join(', ') || 'none'}.
                  </div>
                </div>
              </div>
            </section>
          )}

          <div class="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
              <div class="border-b border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-faint)]">
                {clients.length} client/account records
              </div>
              <div class="max-h-[640px] overflow-y-auto">
                {clients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => setSelectedId(client.id)}
                    class={`w-full border-b border-[var(--color-border)] px-3 py-2 text-left last:border-b-0 ${
                      selected?.id === client.id ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'hover:bg-[var(--color-elevated)]'
                    }`}
                  >
                    <div class="flex items-center gap-2">
                      <UserRound size={13} class="text-[var(--color-accent)]" />
                      <span class="truncate text-[12px] font-semibold text-[var(--color-text)]">{client.name || client.email}</span>
                    </div>
                    <div class="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">{client.email}</div>
                    <div class="mt-0.5 text-[10px] text-[var(--color-text-faint)]">
                      {client.appointmentCount} appts · {client.upcomingAppointmentCount} upcoming · {client.accountStatus}
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <main class="space-y-4">
              {selected && draft && (
                <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
                  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 class="text-[15px] font-semibold text-[var(--color-text)]">{selected.name || selected.email}</h2>
                      <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">
                        Created {agoFromIso(selected.createdAt)} · verified {agoFromIso(selected.emailVerifiedAt)}
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setDraft(toDraft(selected));
                              setEditing(false);
                              setSaveError(null);
                            }}
                            class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          >
                            <X size={13} />
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={save}
                            disabled={saving || !canEdit}
                            class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                            style="background:var(--color-accent)"
                          >
                            <Save size={13} />
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          disabled={!canEdit}
                          class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                          style="background:var(--color-accent)"
                        >
                          Edit account
                        </button>
                      )}
                    </div>
                  </div>

                  {saveMessage && <div class="mb-3 rounded-md border border-[var(--color-status-done)] px-3 py-2 text-[12px] text-[var(--color-status-done)]">{saveMessage}</div>}
                  {saveError && <div class="mb-3 rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[12px] text-[var(--color-status-failed)]">{saveError}</div>}

                  <div class="grid gap-3 md:grid-cols-2">
                    <Field label="Client name">
                      <input class={inputClass} disabled={!editing} value={draft.name} onInput={(e) => updateDraft('name', (e.currentTarget as HTMLInputElement).value)} />
                    </Field>
                    <Field label="Account status">
                      <select class={inputClass} disabled={!editing} value={draft.accountStatus} onChange={(e) => updateDraft('accountStatus', (e.currentTarget as HTMLSelectElement).value)}>
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                        <option value="archived">archived</option>
                        <option value="blocked">blocked</option>
                      </select>
                    </Field>
                    <Field label="Phone">
                      <input class={inputClass} disabled={!editing} value={draft.phone} onInput={(e) => updateDraft('phone', (e.currentTarget as HTMLInputElement).value)} />
                    </Field>
                    <Field label="Email">
                      <input class={inputClass} disabled={!editing} value={draft.email} onInput={(e) => updateDraft('email', (e.currentTarget as HTMLInputElement).value)} />
                    </Field>
                    <Field label="Next-visit free enhancement">
                      <input class={inputClass} disabled={!editing} value={draft.nextVisitFreeEnhancement} onInput={(e) => updateDraft('nextVisitFreeEnhancement', (e.currentTarget as HTMLInputElement).value)} />
                    </Field>
                    <Field label="Enhancement expiration date">
                      <input type="date" class={inputClass} disabled={!editing} value={draft.enhancementExpirationDate} onInput={(e) => updateDraft('enhancementExpirationDate', (e.currentTarget as HTMLInputElement).value)} />
                    </Field>
                    <Field label="Notes">
                      <textarea class={`${inputClass} min-h-[104px] resize-y md:col-span-2`} disabled={!editing} value={draft.notes} onInput={(e) => updateDraft('notes', (e.currentTarget as HTMLTextAreaElement).value)} />
                    </Field>
                  </div>

                  <div class="mt-4 flex flex-wrap gap-4">
                    <label class="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                      <input type="checkbox" disabled={!editing} checked={draft.emailOptIn} onChange={(e) => updateDraft('emailOptIn', (e.currentTarget as HTMLInputElement).checked)} />
                      <Mail size={13} />
                      Email opt-in
                    </label>
                    <label class="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                      <input type="checkbox" disabled={!editing} checked={draft.smsOptIn} onChange={(e) => updateDraft('smsOptIn', (e.currentTarget as HTMLInputElement).checked)} />
                      <MessageSquareText size={13} />
                      SMS/text opt-in
                    </label>
                    <span class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]">
                      <CalendarClock size={12} />
                      Consent is recorded only; no sends happen here.
                    </span>
                  </div>
                </section>
              )}

              <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)]">
                  <History size={14} class="text-[var(--color-accent)]" />
                  Admin action log
                </div>
                {overview.data.actionLog.length === 0 ? (
                  <div class="px-3 py-5 text-center text-[12px] text-[var(--color-text-faint)]">No admin edits logged yet.</div>
                ) : (
                  <div class="max-h-[340px] overflow-y-auto">
                    {overview.data.actionLog.map((entry) => (
                      <div key={entry.id} class="grid gap-1 border-b border-[var(--color-border)] px-3 py-2 text-[11px] last:border-b-0 md:grid-cols-[160px_140px_1fr_100px]">
                        <div class="truncate text-[var(--color-text-muted)]">{entry.adminUser}</div>
                        <div class="font-mono text-[var(--color-accent)]">{entry.field}</div>
                        <div class="truncate font-mono text-[var(--color-text-faint)]">
                          {entry.oldValue ?? 'null'} {'->'} {entry.newValue ?? 'null'}
                        </div>
                        <div class="text-right text-[var(--color-text-faint)]">{agoFromIso(entry.timestamp)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
