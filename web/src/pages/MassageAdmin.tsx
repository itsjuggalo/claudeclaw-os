import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  CalendarClock,
  Gift,
  History,
  LockKeyhole,
  Mail,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Ticket,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPatch, apiPost, apiGet } from '@/lib/api';
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
  rewardBalance: number;
  lastVisitMs: number | null;
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

interface Appointment {
  id: string;
  appt_date: string;
  appt_time: string;
  service_name: string;
  status: string;
  start_ms: number;
  client_email: string;
  enhancement_applied?: string | null;
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
const agoFromMs = (ms: number | null) => (ms ? formatRelativeTime(Math.floor(ms / 1000)) : 'never');

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
const btnGhost = 'inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40';
const btnAccent = 'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40';
const btnDanger = 'inline-flex items-center gap-1 rounded-md border border-[var(--color-status-failed)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-status-failed)] hover:bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] disabled:opacity-40';

export function MassageAdmin() {
  const overview = useFetch<Overview>('/api/massage-admin/clients', 30000);
  const session = useFetch<AdminSession>('/api/massage-admin/session', 30000);
  const [tab, setTab] = useState<'accounts' | 'messaging' | 'promos'>('accounts');

  const migration = overview.data?.migration;
  const canEdit = Boolean(session.data?.canEdit && !migration?.required);

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Massage Admin"
        tabs={
          <>
            <Tab label="Accounts" active={tab === 'accounts'} count={overview.data?.clients.length} onClick={() => setTab('accounts')} />
            <Tab label="Messaging" active={tab === 'messaging'} onClick={() => setTab('messaging')} />
            <Tab label="Promos & Codes" active={tab === 'promos'} onClick={() => setTab('promos')} />
          </>
        }
        actions={
          <button type="button" onClick={() => { overview.refresh(); session.refresh(); }} class={btnGhost}>
            <RefreshCw size={12} /> refresh
          </button>
        }
      />

      {overview.error && <PageState error={overview.error} />}
      {overview.loading && !overview.data && <PageState loading />}

      {overview.data && (
        <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <AuthBanner session={session.data} sessionError={session.error} />

          {migration?.required && (
            <section class="mb-4 rounded-lg border border-[var(--color-warn)] px-4 py-3 text-[12px] text-[var(--color-warn)]">
              <div class="flex items-start gap-2">
                <ShieldAlert size={16} class="mt-0.5 shrink-0" />
                <div>
                  <div class="font-semibold">Migration required before editing</div>
                  <div class="mt-1 text-[var(--color-text-muted)]">
                    Apply <span class="font-mono">{migration.sqlFile}</span> to the massage database.
                    Missing columns: {migration.missingUserColumns.join(', ') || 'none'}. Missing tables: {migration.missingTables.join(', ') || 'none'}.
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === 'accounts' && <AccountsTab overview={overview} canEdit={canEdit} />}
          {tab === 'messaging' && <MessagingTab />}
          {tab === 'promos' && <PromosTab canEdit={canEdit} />}
        </div>
      )}
    </div>
  );
}

function AuthBanner({ session, sessionError }: { session: AdminSession | null; sessionError: string | null }) {
  return (
    <section class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] px-4 py-3">
      <div class="flex flex-wrap items-start gap-3">
        <LockKeyhole size={18} class="mt-0.5 text-[var(--color-accent)]" />
        <div class="min-w-0 flex-1">
          <h2 class="text-[13px] font-semibold text-[var(--color-text)]">Admin console</h2>
          <p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            {session?.canEdit
              ? <>Signed in as <span class="font-semibold text-[var(--color-text)]">{session.adminUser}</span>. Every change is backed up and written to the audit log.</>
              : 'Editing is disabled for this session. Local (loopback) use is trusted; remote access requires an authorized Google sign-in.'}
          </p>
          {!session?.canEdit && (
            <div class="mt-2 flex items-center gap-3">
              <a href="/massage-admin/login" class={btnAccent} style="background:var(--color-accent)">Sign in with Google</a>
              <span class="text-[11px] text-[var(--color-warn)]">{session?.reason || sessionError || ''}</span>
            </div>
          )}
          <p class="mt-2 text-[11px] text-[var(--color-text-faint)]">
            Marketing email/SMS requires the client's explicit opt-in; transactional messages (reminders, intake, resets) always send.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── Accounts tab ──
function AccountsTab({ overview, canEdit }: { overview: ReturnType<typeof useFetch<Overview>>; canEdit: boolean }) {
  const clients = overview.data?.clients ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'created' | 'lastVisit' | 'upcoming'>('name');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = clients;
    if (q) rows = rows.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q));
    const by = {
      name: (a: MassageClient, b: MassageClient) => (a.name || a.email).localeCompare(b.name || b.email),
      created: (a: MassageClient, b: MassageClient) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''),
      lastVisit: (a: MassageClient, b: MassageClient) => (b.lastVisitMs ?? 0) - (a.lastVisitMs ?? 0),
      upcoming: (a: MassageClient, b: MassageClient) => b.upcomingAppointmentCount - a.upcomingAppointmentCount,
    }[sort];
    return [...rows].sort(by);
  }, [clients, query, sort]);

  const selected = useMemo(
    () => clients.find((c) => c.id === selectedId) ?? filtered[0] ?? null,
    [clients, filtered, selectedId],
  );

  useEffect(() => {
    if (!selectedId && filtered[0]) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  return (
    <div class="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <input
            class={`${inputClass} py-1.5`}
            placeholder="Search name / email / phone"
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div class="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
          <select class={`${inputClass} py-1 w-auto`} value={sort} onChange={(e) => setSort((e.currentTarget as HTMLSelectElement).value as any)}>
            <option value="name">Sort: Name</option>
            <option value="created">Sort: Newest</option>
            <option value="lastVisit">Sort: Last visit</option>
            <option value="upcoming">Sort: Upcoming</option>
          </select>
          <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => setShowCreate(true)}>
            <UserPlus size={12} /> New
          </button>
        </div>
        <div class="max-h-[620px] overflow-y-auto">
          {filtered.map((client) => (
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
                {client.accountStatus !== 'active' && (
                  <span class="rounded bg-[var(--color-elevated)] px-1 text-[9px] uppercase text-[var(--color-warn)]">{client.accountStatus}</span>
                )}
              </div>
              <div class="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">{client.email}</div>
              <div class="mt-0.5 text-[10px] text-[var(--color-text-faint)]">
                {client.appointmentCount} appts · {client.upcomingAppointmentCount} upcoming · ★{client.rewardBalance}
                {client.nextVisitFreeEnhancement ? ' · 🎁' : ''}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div class="px-3 py-6 text-center text-[12px] text-[var(--color-text-faint)]">No matching clients.</div>}
        </div>
      </aside>

      <main class="space-y-4">
        {showCreate && <CreateAccountCard onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); overview.refresh(); }} />}
        {selected && <AccountDetail key={selected.id} client={selected} canEdit={canEdit} onChanged={() => overview.refresh()} />}
        <ActionLog actionLog={overview.data?.actionLog ?? []} />
      </main>
    </div>
  );
}

function CreateAccountCard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [welcome, setWelcome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ ok?: boolean; error?: string }>('/api/massage-admin/clients/create', { email, name, phone, sendWelcome: welcome });
      if (r.error || r.ok === false) { setErr(r.error || 'failed'); return; }
      onDone();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-[13px] font-semibold text-[var(--color-text)]">New account</h3>
        <button type="button" class={btnGhost} onClick={onClose}><X size={12} /></button>
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        <Field label="Email"><input class={inputClass} value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Name"><input class={inputClass} value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Phone"><input class={inputClass} value={phone} onInput={(e) => setPhone((e.currentTarget as HTMLInputElement).value)} /></Field>
      </div>
      <div class="mt-3 flex items-center justify-between">
        <label class="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
          <input type="checkbox" checked={welcome} onChange={(e) => setWelcome((e.currentTarget as HTMLInputElement).checked)} /> Send welcome email
        </label>
        <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={busy || !email.includes('@')} onClick={create}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </div>
      {err && <div class="mt-2 text-[11px] text-[var(--color-status-failed)]">{err}</div>}
    </section>
  );
}

function AccountDetail({ client, canEdit, onChanged }: { client: MassageClient; canEdit: boolean; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(toDraft(client));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setDraft(toDraft(client)); setEditing(false); setMsg(null); setErr(null); }, [client.id]);

  function up<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft((d) => ({ ...d, [k]: v })); }
  const flash = (m: string) => { setMsg(m); setErr(null); onChanged(); };

  async function save() {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const r = await apiPatch<{ changed?: number; error?: string }>(`/api/massage-admin/clients/${encodeURIComponent(client.id)}`, draft);
      if (r.error) { setErr(r.error); return; }
      setEditing(false); flash(`Saved ${r.changed ?? 0} change${r.changed === 1 ? '' : 's'}.`);
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setSaving(false); }
  }

  async function action(path: string, confirmMsg?: string, bodyObj?: unknown) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setErr(null); setMsg(null);
    try {
      const r = await apiPost<{ ok?: boolean; error?: string; status?: string; results?: any }>(`/api/massage-admin/clients/${encodeURIComponent(client.id)}/${path}`, bodyObj);
      if (r.error || r.ok === false) { setErr(r.error || JSON.stringify(r.results || r)); return; }
      flash(`Done: ${path}${r.status ? ` (${r.status})` : ''}.`);
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
  }

  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      {/* header + summary */}
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-[15px] font-semibold text-[var(--color-text)]">{client.name || client.email}</h2>
          <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-faint)]">
            <span>Created {agoFromIso(client.createdAt)}</span>
            <span>· Verified {client.emailVerifiedAt ? agoFromIso(client.emailVerifiedAt) : <span class="text-[var(--color-warn)]">no</span>}</span>
            <span>· {client.appointmentCount} visits · last {agoFromMs(client.lastVisitMs)}</span>
            <span>· ★ {client.rewardBalance} rewards</span>
            {client.nextVisitFreeEnhancement && <span class="text-[var(--color-accent)]">· 🎁 {client.nextVisitFreeEnhancement}{client.enhancementExpirationDate ? ` (exp ${client.enhancementExpirationDate})` : ''}</span>}
          </div>
        </div>
        <div class="flex items-center gap-2">
          {editing ? (
            <>
              <button type="button" class={btnGhost} onClick={() => { setDraft(toDraft(client)); setEditing(false); setErr(null); }}><X size={13} /> Cancel</button>
              <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={saving || !canEdit} onClick={save}><Save size={13} /> {saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit} onClick={() => setEditing(true)}>Edit account</button>
          )}
        </div>
      </div>

      {msg && <div class="mb-3 rounded-md border border-[var(--color-status-done)] px-3 py-2 text-[12px] text-[var(--color-status-done)]">{msg}</div>}
      {err && <div class="mb-3 rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[12px] text-[var(--color-status-failed)]">{err}</div>}

      {/* edit fields */}
      <div class="grid gap-3 md:grid-cols-2">
        <Field label="Client name"><input class={inputClass} disabled={!editing} value={draft.name} onInput={(e) => up('name', (e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Account status">
          <select class={inputClass} disabled={!editing} value={draft.accountStatus} onChange={(e) => up('accountStatus', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="active">active</option><option value="inactive">inactive</option><option value="archived">archived</option><option value="blocked">blocked</option>
          </select>
        </Field>
        <Field label="Phone"><input class={inputClass} disabled={!editing} value={draft.phone} onInput={(e) => up('phone', (e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Email"><input class={inputClass} disabled={!editing} value={draft.email} onInput={(e) => up('email', (e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Next-visit free enhancement"><input class={inputClass} disabled={!editing} value={draft.nextVisitFreeEnhancement} onInput={(e) => up('nextVisitFreeEnhancement', (e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Enhancement expiration date"><input type="date" class={inputClass} disabled={!editing} value={draft.enhancementExpirationDate} onInput={(e) => up('enhancementExpirationDate', (e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Notes"><textarea class={`${inputClass} min-h-[88px] resize-y md:col-span-2`} disabled={!editing} value={draft.notes} onInput={(e) => up('notes', (e.currentTarget as HTMLTextAreaElement).value)} /></Field>
      </div>
      <div class="mt-4 flex flex-wrap gap-4">
        <label class="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]"><input type="checkbox" disabled={!editing} checked={draft.emailOptIn} onChange={(e) => up('emailOptIn', (e.currentTarget as HTMLInputElement).checked)} /><Mail size={13} /> Email opt-in</label>
        <label class="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]"><input type="checkbox" disabled={!editing} checked={draft.smsOptIn} onChange={(e) => up('smsOptIn', (e.currentTarget as HTMLInputElement).checked)} /><MessageSquareText size={13} /> SMS opt-in</label>
      </div>

      {/* lifecycle actions */}
      <div class="mt-5 border-t border-[var(--color-border)] pt-4">
        <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Account actions</div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => action('reset-password')}>Send reset email</button>
          <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => { const p = window.prompt('New temporary password (min 8 chars):'); if (p) action('set-password', undefined, { password: p }); }}>Set temp password</button>
          <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => action('verify', undefined, { verified: !client.emailVerifiedAt })}>{client.emailVerifiedAt ? 'Un-verify email' : 'Force verify email'}</button>
          <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => { const v = window.prompt('Free enhancement (blank clears):', client.nextVisitFreeEnhancement || ''); if (v !== null) { const exp = window.prompt('Expires (YYYY-MM-DD, blank = none):', client.enhancementExpirationDate || '') || ''; action('enhancement', undefined, { value: v, expires: exp }); } }}><Gift size={12} /> Grant enhancement</button>
          <button type="button" class={btnDanger} disabled={!canEdit} onClick={() => action('delete', `Delete ${client.email}? Bookings survive as guest records. This cannot be undone.`)}><Trash2 size={12} /> Delete account</button>
        </div>
      </div>

      <RewardPanel client={client} canEdit={canEdit} onDone={flash} />
      <AppointmentsPanel client={client} canEdit={canEdit} onDone={flash} />
      <MessagePanel client={client} canEdit={canEdit} onDone={flash} />
    </section>
  );
}

function RewardPanel({ client, canEdit, onDone }: { client: MassageClient; canEdit: boolean; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function adjust(delta: number) {
    setBusy(true);
    try {
      const reason = delta > 0 ? 'admin_grant' : 'admin_deduct';
      await apiPost(`/api/massage-admin/clients/${encodeURIComponent(client.id)}/reward`, { delta, reason });
      onDone(`Reward ${delta > 0 ? '+' : ''}${delta} applied.`);
    } finally { setBusy(false); }
  }
  return (
    <div class="mt-5 border-t border-[var(--color-border)] pt-4">
      <div class="mb-2 flex items-center justify-between">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Loyalty · balance {client.rewardBalance}</div>
        <div class="flex gap-2">
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={() => adjust(-1)}>−1</button>
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={() => adjust(1)}>+1</button>
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={() => adjust(6)}>+6 (full card)</button>
        </div>
      </div>
    </div>
  );
}

function AppointmentsPanel({ client, canEdit, onDone }: { client: MassageClient; canEdit: boolean; onDone: (m: string) => void }) {
  const appts = useFetch<{ appointments: Appointment[] }>(`/api/massage-admin/clients/${encodeURIComponent(client.id)}/appointments`, 0);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(apptId: string, action: 'confirm' | 'decline' | 'cancel' | 'remind' | 'nudge-intake') {
    if ((action === 'cancel' || action === 'decline') && !window.confirm(`${action} this appointment? The client is emailed.`)) return;
    setBusy(apptId + action);
    try {
      const path = action === 'remind' ? 'remind' : action === 'nudge-intake' ? 'nudge-intake' : action;
      await apiPost(`/api/massage-admin/appointments/${encodeURIComponent(apptId)}/${path}`, {});
      onDone(`Appointment ${action} done.`); appts.refresh();
    } finally { setBusy(null); }
  }

  const rows = appts.data?.appointments ?? [];
  return (
    <div class="mt-5 border-t border-[var(--color-border)] pt-4">
      <div class="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
        <CalendarClock size={12} /> Appointments ({rows.length})
      </div>
      {appts.loading && !appts.data && <div class="text-[11px] text-[var(--color-text-faint)]">Loading…</div>}
      {rows.length === 0 && !appts.loading && <div class="text-[11px] text-[var(--color-text-faint)]">No appointments.</div>}
      <div class="space-y-1.5">
        {rows.map((a) => (
          <div key={a.id} class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-[11px]">
            <div class="text-[var(--color-text-muted)]">
              <span class="font-semibold text-[var(--color-text)]">{a.appt_date} {a.appt_time}</span> · {a.service_name} ·{' '}
              <span class={a.status === 'confirmed' ? 'text-[var(--color-status-done)]' : a.status === 'requested' ? 'text-[var(--color-warn)]' : 'text-[var(--color-text-faint)]'}>{a.status}</span>
              {a.enhancement_applied && <span class="text-[var(--color-accent)]"> · 🎁 {a.enhancement_applied}</span>}
            </div>
            <div class="flex flex-wrap gap-1">
              {a.status === 'requested' && <button type="button" class={btnGhost} disabled={!canEdit || !!busy} onClick={() => act(a.id, 'confirm')}>Confirm</button>}
              {a.status === 'requested' && <button type="button" class={btnGhost} disabled={!canEdit || !!busy} onClick={() => act(a.id, 'decline')}>Decline</button>}
              {a.status === 'confirmed' && <button type="button" class={btnGhost} disabled={!canEdit || !!busy} onClick={() => act(a.id, 'cancel')}>Cancel</button>}
              {a.status === 'confirmed' && <button type="button" class={btnGhost} disabled={!canEdit || !!busy} onClick={() => act(a.id, 'remind')}>Remind</button>}
              <button type="button" class={btnGhost} disabled={!canEdit || !!busy} onClick={() => act(a.id, 'nudge-intake')}>Intake nudge</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessagePanel({ client, canEdit, onDone }: { client: MassageClient; canEdit: boolean; onDone: (m: string) => void }) {
  const [channel, setChannel] = useState<'email' | 'sms' | 'both'>('email');
  const [subject, setSubject] = useState('A note from Massage By Mike');
  const [bodyText, setBodyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ results?: any; error?: string }>(`/api/massage-admin/clients/${encodeURIComponent(client.id)}/message`, { channel, subject, body: bodyText });
      if (r.error) { setErr(r.error); return; }
      onDone('Message queued (see Messaging tab for delivery).'); setBodyText('');
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  const optWarn = (channel !== 'sms' && !client.emailOptIn) || (channel !== 'email' && !client.smsOptIn);
  return (
    <div class="mt-5 border-t border-[var(--color-border)] pt-4">
      <div class="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]"><Send size={12} /> Custom message</div>
      <div class="mb-2 text-[11px] text-[var(--color-text-faint)]">Sends as <span class="font-semibold text-[var(--color-text-muted)]">Massage By Mike &lt;MassageByMike92@gmail.com&gt;</span> — your login is for attribution only, never the sender.</div>
      <div class="grid gap-2 md:grid-cols-[120px_1fr]">
        <select class={inputClass} value={channel} onChange={(e) => setChannel((e.currentTarget as HTMLSelectElement).value as any)}>
          <option value="email">Email</option><option value="sms">SMS</option><option value="both">Both</option>
        </select>
        <input class={inputClass} placeholder="Subject" value={subject} onInput={(e) => setSubject((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <textarea class={`${inputClass} mt-2 min-h-[80px] resize-y`} placeholder="Message body" value={bodyText} onInput={(e) => setBodyText((e.currentTarget as HTMLTextAreaElement).value)} />
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-faint)]">{optWarn ? '⚠ client is not opted in for that channel — send will be skipped' : 'client is opted in'}</span>
        <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !bodyText.trim()} onClick={send}>{busy ? 'Sending…' : 'Send now'}</button>
      </div>
      {err && <div class="mt-2 text-[11px] text-[var(--color-status-failed)]">{err}</div>}
    </div>
  );
}

function ActionLog({ actionLog }: { actionLog: AdminAction[] }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)]">
        <History size={14} class="text-[var(--color-accent)]" /> Admin action log
      </div>
      {actionLog.length === 0 ? (
        <div class="px-3 py-5 text-center text-[12px] text-[var(--color-text-faint)]">No admin edits logged yet.</div>
      ) : (
        <div class="max-h-[300px] overflow-y-auto">
          {actionLog.map((e) => (
            <div key={e.id} class="grid gap-1 border-b border-[var(--color-border)] px-3 py-2 text-[11px] last:border-b-0 md:grid-cols-[170px_150px_1fr_90px]">
              <div class="truncate text-[var(--color-text-muted)]">{e.adminUser}</div>
              <div class="font-mono text-[var(--color-accent)]">{e.field}</div>
              <div class="truncate font-mono text-[var(--color-text-faint)]">{e.oldValue ?? 'null'} {'->'} {e.newValue ?? 'null'}</div>
              <div class="text-right text-[var(--color-text-faint)]">{agoFromIso(e.timestamp)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────── Messaging tab ──
interface Schedule {
  schedule: { reminder36h: { on: boolean; leadHours: number }; sameDay2h: { on: boolean; leadHours: number }; reviewRequest: { on: boolean; live: boolean }; intakeNudge: { on: boolean } };
  mail: { live: boolean; from: string };
  sms: { mode: string; live: boolean; label: string };
}
interface MessageRow { id: number; channel: string; template: string; recipient: string | null; subject: string | null; status: string; detail: string | null; admin_user: string; sent_at: string }

function MessagingTab() {
  const sched = useFetch<Schedule>('/api/massage-admin/schedule', 60000);
  const log = useFetch<{ messages: MessageRow[] }>('/api/massage-admin/messages', 30000);
  const s = sched.data;
  const pill = (on: boolean, label: string) => (
    <span class={`rounded px-2 py-0.5 text-[11px] font-semibold ${on ? 'bg-[color-mix(in_srgb,var(--color-status-done)_18%,transparent)] text-[var(--color-status-done)]' : 'bg-[var(--color-elevated)] text-[var(--color-text-faint)]'}`}>{label}</span>
  );
  return (
    <div class="space-y-4">
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
        <h3 class="mb-3 text-[13px] font-semibold text-[var(--color-text)]">Automated schedule</h3>
        {s ? (
          <div class="flex flex-wrap gap-2">
            {pill(s.schedule.reminder36h.on, `36h reminder ${s.schedule.reminder36h.on ? 'ON' : 'off'}`)}
            {pill(s.schedule.sameDay2h.on, `2h reminder ${s.schedule.sameDay2h.on ? 'ON' : 'off'}`)}
            {pill(s.schedule.intakeNudge.on, `intake nudge ${s.schedule.intakeNudge.on ? 'ON' : 'off'}`)}
            {pill(s.schedule.reviewRequest.on && s.schedule.reviewRequest.live, `review request ${s.schedule.reviewRequest.on ? (s.schedule.reviewRequest.live ? 'LIVE' : 'dry-run') : 'off'}`)}
            {pill(s.mail.live, `email ${s.mail.live ? 'LIVE' : 'dry-run'}`)}
            {pill(s.sms.live, `SMS ${s.sms.label}`)}
          </div>
        ) : <div class="text-[12px] text-[var(--color-text-faint)]">Loading…</div>}
        <p class="mt-3 text-[11px] text-[var(--color-text-faint)]">Schedules are set on the massage server (env flags). SMS stays dry-run until a free provider is enabled. Per-appointment manual sends live on each account's Appointments panel.</p>
      </section>

      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <div class="text-[12px] font-semibold text-[var(--color-text)]">Send log</div>
          <button type="button" class={btnGhost} onClick={() => log.refresh()}><RefreshCw size={11} /> refresh</button>
        </div>
        {(log.data?.messages ?? []).length === 0 ? (
          <div class="px-3 py-5 text-center text-[12px] text-[var(--color-text-faint)]">No messages sent yet.</div>
        ) : (
          <div class="max-h-[520px] overflow-y-auto">
            {(log.data?.messages ?? []).map((m) => (
              <div key={m.id} class="grid gap-1 border-b border-[var(--color-border)] px-3 py-2 text-[11px] last:border-b-0 md:grid-cols-[70px_130px_1fr_110px_90px]">
                <div class="font-mono text-[var(--color-accent)]">{m.channel}</div>
                <div class="text-[var(--color-text-muted)]">{m.template}</div>
                <div class="truncate text-[var(--color-text-faint)]">{m.recipient} · {m.subject}</div>
                <div class={m.status === 'sent' ? 'text-[var(--color-status-done)]' : m.status === 'error' ? 'text-[var(--color-status-failed)]' : 'text-[var(--color-text-faint)]'}>{m.status}</div>
                <div class="text-right text-[var(--color-text-faint)]">{agoFromIso(m.sent_at)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────── Promos tab ──
interface CodeRow { code: string; type: string; value: number; balance: number; label: string | null; active: number; uses: number; max_uses: number | null; expires_at: string | null }

function PromosTab({ canEdit }: { canEdit: boolean }) {
  const codes = useFetch<{ codes: CodeRow[] }>('/api/massage-admin/codes', 30000);
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('10');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [giftAmt, setGiftAmt] = useState('50');

  async function upsert() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ ok?: boolean; message?: string }>('/api/massage-admin/codes', { code, type, value: Number(value), label });
      if (r.ok === false) { setErr(r.message || 'failed'); return; }
      setCode(''); setLabel(''); codes.refresh();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function toggle(c: CodeRow) { await apiPost(`/api/massage-admin/codes/${encodeURIComponent(c.code)}/toggle`, { active: !c.active }); codes.refresh(); }
  async function issueGift() { setBusy(true); try { await apiPost('/api/massage-admin/gift/issue', { amount: Number(giftAmt) }); codes.refresh(); } finally { setBusy(false); } }

  const rows = codes.data?.codes ?? [];
  return (
    <div class="space-y-4">
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
        <h3 class="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text)]"><Ticket size={14} class="text-[var(--color-accent)]" /> Create / edit promo</h3>
        <div class="grid gap-2 md:grid-cols-[1fr_110px_100px_1fr_auto]">
          <input class={inputClass} placeholder="CODE" value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value.toUpperCase())} />
          <select class={inputClass} value={type} onChange={(e) => setType((e.currentTarget as HTMLSelectElement).value as any)}><option value="percent">% off</option><option value="fixed">$ off</option></select>
          <input class={inputClass} type="number" value={value} onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)} />
          <input class={inputClass} placeholder="Label (optional)" value={label} onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)} />
          <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !code} onClick={upsert}>Save</button>
        </div>
        <div class="mt-3 flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
          <Gift size={14} class="text-[var(--color-accent)]" />
          <span class="text-[12px] text-[var(--color-text-muted)]">Mint gift certificate $</span>
          <input class={`${inputClass} w-24`} type="number" value={giftAmt} onInput={(e) => setGiftAmt((e.currentTarget as HTMLInputElement).value)} />
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={issueGift}>Issue gift</button>
        </div>
        {err && <div class="mt-2 text-[11px] text-[var(--color-status-failed)]">{err}</div>}
      </section>

      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="border-b border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)]">{rows.length} codes</div>
        {rows.length === 0 ? <div class="px-3 py-5 text-center text-[12px] text-[var(--color-text-faint)]">No codes yet.</div> : (
          <div class="max-h-[520px] overflow-y-auto">
            {rows.map((c) => (
              <div key={c.code} class="grid items-center gap-1 border-b border-[var(--color-border)] px-3 py-2 text-[11px] last:border-b-0 md:grid-cols-[130px_90px_1fr_120px_80px]">
                <div class="font-mono font-semibold text-[var(--color-text)]">{c.code}</div>
                <div class="text-[var(--color-text-muted)]">{c.type === 'percent' ? `${c.value}%` : c.type === 'gift' ? `$${c.balance}/${c.value}` : `$${c.value}`}</div>
                <div class="truncate text-[var(--color-text-faint)]">{c.label || '—'} · {c.uses} used{c.max_uses ? `/${c.max_uses}` : ''}{c.expires_at ? ` · exp ${c.expires_at.slice(0, 10)}` : ''}</div>
                <div>{c.active ? <span class="text-[var(--color-status-done)]">active</span> : <span class="text-[var(--color-text-faint)]">disabled</span>}</div>
                <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => toggle(c)}>{c.active ? 'Disable' : 'Enable'}</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
