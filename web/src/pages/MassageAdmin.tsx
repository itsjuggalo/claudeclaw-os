import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Activity,
  CalendarClock,
  Check,
  ClipboardList,
  Copy,
  Gift,
  History,
  Keyboard,
  LockKeyhole,
  Mail,
  MessageSquareText,
  Mic,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Stethoscope,
  Ticket,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { NestedSquaresSpinner } from '@/components/NestedSquaresSpinner';
import { useFetch, invalidateFetchCache } from '@/lib/useFetch';
import { useSpin } from '@/lib/useSpin';
import { ScheduleCalendar, isoLocalDate } from '@/components/massage/ScheduleCalendar';
import { apiPatch, apiPost, apiGet, apiPut, apiDelete } from '@/lib/api';
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

// A form field. Optionally shows a compact "↺ reuse…" picker in the label row, populated
// with values this SAME client had in earlier SOAP notes — pick one to autofill the field
// (cuts repetitive typing for regulars). The underlying input/textarea is never changed.
function Field({ label, children, prior, onPick }: {
  label: string; children: preact.ComponentChildren; prior?: string[]; onPick?: (v: string) => void;
}) {
  const hasPrior = !!(prior && prior.length && onPick);
  return (
    <div class="block">
      <div class="mb-1 flex items-center justify-between gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
        {hasPrior && (
          <select
            class="max-w-[55%] shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px] text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
            title="Reuse a value you wrote before for this client"
            value=""
            onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) onPick!(v); (e.currentTarget as HTMLSelectElement).value = ''; }}
          >
            <option value="">↺ reuse…</option>
            {prior!.map((p, i) => <option key={i} value={p}>{p.length > 60 ? p.slice(0, 57) + '…' : p}</option>)}
          </select>
        )}
      </div>
      {children}
    </div>
  );
}

const inputClass = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60';
const btnGhost = 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)] disabled:opacity-40';
const btnAccent = 'inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40';

// ── SOAP fast-entry toolkit (tap-first, <5-minute notes) ──────────────────────
// Web Speech API dictation. onText appends each final transcript. Chrome-only; the
// mic button hides itself where speech recognition is unavailable.
function useDictation(onText: (t: string) => void) {
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const SR = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const supported = !!SR;
  const toggle = () => {
    if (!supported) return;
    if (listening) { try { recRef.current?.stop(); } catch { /* noop */ } setListening(false); return; }
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = false; rec.continuous = true;
    rec.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
      if (t.trim()) onText(t.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);
  return { listening, toggle, supported };
}

// Append a phrase/transcript to a field, tidying separators.
const appendText = (cur: string, add: string) => {
  const c = (cur || '').trimEnd();
  if (!c) return add;
  return /[.,;:]$/.test(c) ? `${c} ${add}` : `${c}, ${add}`;
};

// Tap-to-insert canned phrases per SOAP field, and quick finding chips per body region.
const SOAP_PHRASES: Record<string, string[]> = {
  subjective: ['Client reports', 'Pain worse with', 'Pain better with', 'No new concerns', 'Sleeping poorly', 'Stress / tension'],
  objective: ['Palpable hypertonicity', 'Restricted ROM', 'Trigger points noted', 'Adhesions present', 'Tender on palpation', 'Postural imbalance'],
  assessment: ['Myofascial restriction', 'Muscle tension / spasm', 'Postural strain', 'Responding well', 'Chronic holding pattern'],
  plan: ['Continue current plan', 'Increase frequency', 'Focus next session', '4–6 week plan', 'Reassess next visit'],
  home_care: ['Hydrate', 'Daily stretching', 'Heat before / ice after', 'Rest the area', 'Self-massage'],
  referrals: ['None', 'Physician follow-up', 'Chiropractic'],
  adverse_reactions: ['None', 'Mild soreness expected', 'Tolerated well'],
};
const FINDING_CHIPS = ['Tight', 'Knotted', 'Spasm', 'Tender', 'Trigger pt', 'Adhesions', 'ROM↓', 'Inflamed', 'Hypertonic'];
// Region-specific quick findings shown FIRST (before the common chips) so a tapped
// region offers its most-likely findings in one tap. Additive — common chips still follow.
const REGION_FINDING_CHIPS: Record<string, string[]> = {
  'Neck': ['Stiff', 'Reduced rotation'],
  'Shoulders': ['Impinged', 'Elevated'],
  'Back': ['Erector tension', 'SI tightness'],
  'Arms & Hands': ['Forearm tight', 'Grip fatigue'],
  'Legs': ['Hamstring tight', 'Calf knots'],
  'Scalp': ['Tension band'],
  'Face': ['Jaw / TMJ'],
  'Pectoral Muscles': ['Rounded posture'],
  'Abdomen': ['Guarding'],
  'Gluteal Region': ['Piriformis', 'Glute med'],
  'Feet': ['Plantar tension', 'Arch strain'],
};
// Default severity for a freshly-tapped region: a real, mild baseline (not 0) so the
// flag immediately shows a color AND lands on the trend charts; therapist adjusts up/down.
const DEFAULT_SEVERITY = 3;

function Chip({ label, onClick, on }: { label: string; onClick: () => void; on?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      class={`rounded-full border px-2 py-0.5 text-[11px] leading-none transition ${on
        ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-text)]'
        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
      {label}
    </button>
  );
}

function MicButton({ onText }: { onText: (t: string) => void }) {
  const { listening, toggle, supported } = useDictation(onText);
  if (!supported) return null;
  return (
    <button type="button" title={listening ? 'Stop dictation' : 'Dictate (voice to text)'} onClick={toggle}
      class={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${listening
        ? 'border-[var(--color-status-failed)] text-[var(--color-status-failed)] animate-pulse'
        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
      <Mic size={12} /> {listening ? 'listening…' : 'voice'}
    </button>
  );
}

// Narrative SOAP field: tap-first (canned-phrase chips + reuse-from-history) with a mic
// (voice→text) and a keyboard button that reveals the textarea for manual typing.
function NoteField({ label, value, onChange, phraseKey, prior }: {
  label: string; value: string; onChange: (v: string) => void; phraseKey?: string; prior?: string[];
}) {
  const [typing, setTyping] = useState<boolean>(!!value);
  const phrases = (phraseKey && SOAP_PHRASES[phraseKey]) || [];
  return (
    <div class="block">
      <div class="mb-1 flex flex-wrap items-center justify-between gap-1">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
        <div class="flex items-center gap-1">
          <MicButton onText={(t) => onChange(appendText(value, t))} />
          <button type="button" title="Type manually" onClick={() => setTyping((v) => !v)}
            class={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${typing
              ? 'border-[var(--color-accent)] text-[var(--color-text)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
            <Keyboard size={12} /> type
          </button>
          {prior && prior.length > 0 && (
            <select class="max-w-[130px] rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px] text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
              title="Reuse a value you wrote before for this client" value=""
              onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) { onChange(v); setTyping(true); } (e.currentTarget as HTMLSelectElement).value = ''; }}>
              <option value="">↺ reuse…</option>
              {prior.map((p, i) => <option key={i} value={p}>{p.length > 50 ? p.slice(0, 47) + '…' : p}</option>)}
            </select>
          )}
        </div>
      </div>
      {phrases.length > 0 && (
        <div class="mb-1 flex flex-wrap gap-1">
          {phrases.map((p) => <Chip key={p} label={`+ ${p}`} onClick={() => { onChange(appendText(value, p)); setTyping(true); }} />)}
        </div>
      )}
      {(typing || !!value) && (
        <textarea class={`${inputClass} min-h-[52px] resize-y`} value={value} onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)} />
      )}
    </div>
  );
}
const btnDanger = 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-status-failed)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-status-failed)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] disabled:opacity-40';

export function MassageAdmin() {
  const overview = useFetch<Overview>('/api/massage-admin/clients', 30000);
  const session = useFetch<AdminSession>('/api/massage-admin/session', 30000);
  const { busy: refreshing, spin } = useSpin();
  const [tab, setTab] = useState<'profile' | 'accounts' | 'intakes' | 'soap' | 'messaging' | 'promos' | 'availability'>('profile');
  // Fetched here (not just in the tab) so the tab label can show a pending-request count badge.
  const pendingReqs = useFetch<PendingResp>('/api/massage-admin/availability/pending', 30000);

  const migration = overview.data?.migration;
  const canEdit = Boolean(session.data?.canEdit && !migration?.required);

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Massage Admin"
        tabs={
          <>
            <Tab label="Client Profile" active={tab === 'profile'} count={overview.data?.clients.length} onClick={() => setTab('profile')} />
            <Tab label="Accounts" active={tab === 'accounts'} onClick={() => setTab('accounts')} />
            <Tab label="Intake Forms" active={tab === 'intakes'} onClick={() => setTab('intakes')} />
            <Tab label="SOAP Notes" active={tab === 'soap'} onClick={() => setTab('soap')} />
            <Tab label="Messaging" active={tab === 'messaging'} onClick={() => setTab('messaging')} />
            <Tab label="Promos & Codes" active={tab === 'promos'} onClick={() => setTab('promos')} />
            <Tab label="Availability" active={tab === 'availability'} count={pendingReqs.data?.pending?.length || undefined} onClick={() => setTab('availability')} />
          </>
        }
        actions={
          <button type="button" onClick={() => void spin(() => { overview.refresh(); session.refresh(); })} disabled={refreshing} aria-busy={refreshing} class={btnGhost}>
            {refreshing ? <NestedSquaresSpinner size={12} /> : <RefreshCw size={12} />} refresh
          </button>
        }
      />

      {overview.error && <PageState error={overview.error} />}
      {overview.loading && !overview.data && <PageState loading />}

      {overview.data && (
        <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <AuthBanner session={session.data} sessionError={session.error} />

          {migration?.required && (
            <section class="mb-4 rounded-lg border border-[var(--color-warn)] px-4 py-3 text-[13px] text-[var(--color-warn)]">
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

          {tab === 'profile' && <ClientProfileTab overview={overview} canEdit={canEdit} />}
          {tab === 'accounts' && <AccountsTab overview={overview} canEdit={canEdit} />}
          {tab === 'intakes' && <IntakesTab canEdit={canEdit} />}
          {tab === 'soap' && <SoapTab overview={overview} canEdit={canEdit} />}
          {tab === 'messaging' && <MessagingTab />}
          {tab === 'promos' && <PromosTab canEdit={canEdit} />}
          {tab === 'availability' && <AvailabilityTab canEdit={canEdit} pending={pendingReqs} />}
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
          <p class="mt-1 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
            {session?.canEdit
              ? <>Signed in as <span class="font-semibold text-[var(--color-text)]">{session.adminUser}</span>. Every change is backed up and written to the audit log.</>
              : 'Editing is disabled for this session. Local (loopback) use is trusted; remote access requires an authorized Google sign-in.'}
          </p>
          {!session?.canEdit && (
            <div class="mt-2 flex items-center gap-3">
              <a href="/massage-admin/login" class={btnAccent} style="background:var(--color-accent)">Sign in with Google</a>
              <span class="text-[12px] text-[var(--color-warn)]">{session?.reason || sessionError || ''}</span>
            </div>
          )}
          <p class="mt-2 text-[12px] text-[var(--color-text-faint)]">
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
              class={`flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                selected?.id === client.id ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'hover:bg-[var(--color-elevated)]'
              }`}
            >
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)]">
                <UserRound size={15} class="text-[var(--color-accent)]" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-[14px] font-semibold text-[var(--color-text)]">{client.name || client.email}</span>
                  {client.accountStatus !== 'active' && (
                    <span class="rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-warn)]">{client.accountStatus}</span>
                  )}
                </span>
                <span class="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{client.email}</span>
                <span class="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">
                  {client.appointmentCount} appts · {client.upcomingAppointmentCount} upcoming · ★{client.rewardBalance}
                  {client.nextVisitFreeEnhancement ? ' · 🎁' : ''}
                </span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div class="px-3 py-6 text-center text-[13px] text-[var(--color-text-faint)]">No matching clients.</div>}
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
        <label class="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
          <input type="checkbox" checked={welcome} onChange={(e) => setWelcome((e.currentTarget as HTMLInputElement).checked)} /> Send welcome email
        </label>
        <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={busy || !email.includes('@')} onClick={create}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </div>
      {err && <div class="mt-2 text-[12px] text-[var(--color-status-failed)]">{err}</div>}
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
          <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-text-faint)]">
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

      {msg && <div class="mb-3 rounded-md border border-[var(--color-status-done)] px-3 py-2 text-[13px] text-[var(--color-status-done)]">{msg}</div>}
      {err && <div class="mb-3 rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[13px] text-[var(--color-status-failed)]">{err}</div>}

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
        <label class="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]"><input type="checkbox" disabled={!editing} checked={draft.emailOptIn} onChange={(e) => up('emailOptIn', (e.currentTarget as HTMLInputElement).checked)} /><Mail size={13} /> Email opt-in</label>
        <label class="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]"><input type="checkbox" disabled={!editing} checked={draft.smsOptIn} onChange={(e) => up('smsOptIn', (e.currentTarget as HTMLInputElement).checked)} /><MessageSquareText size={13} /> SMS opt-in</label>
      </div>

      {/* lifecycle actions */}
      <div class="mt-5 border-t border-[var(--color-border)] pt-4">
        <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Account actions</div>
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
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Loyalty · balance {client.rewardBalance}</div>
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
      <div class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
        <CalendarClock size={12} /> Appointments ({rows.length})
      </div>
      {appts.loading && !appts.data && <div class="text-[12px] text-[var(--color-text-faint)]">Loading…</div>}
      {rows.length === 0 && !appts.loading && <div class="text-[12px] text-[var(--color-text-faint)]">No appointments.</div>}
      <div class="space-y-1.5">
        {rows.map((a) => (
          <div key={a.id} class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2.5 text-[12px] transition-colors hover:bg-[var(--color-elevated)]">
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
      <div class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]"><Send size={12} /> Custom message</div>
      <div class="mb-2 text-[12px] text-[var(--color-text-faint)]">Sends as <span class="font-semibold text-[var(--color-text-muted)]">Massage By Mike &lt;MassageByMike92@gmail.com&gt;</span> — your login is for attribution only, never the sender.</div>
      <div class="grid gap-2 md:grid-cols-[120px_1fr]">
        <select class={inputClass} value={channel} onChange={(e) => setChannel((e.currentTarget as HTMLSelectElement).value as any)}>
          <option value="email">Email</option><option value="sms">SMS</option><option value="both">Both</option>
        </select>
        <input class={inputClass} placeholder="Subject" value={subject} onInput={(e) => setSubject((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <textarea class={`${inputClass} mt-2 min-h-[80px] resize-y`} placeholder="Message body" value={bodyText} onInput={(e) => setBodyText((e.currentTarget as HTMLTextAreaElement).value)} />
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[12px] text-[var(--color-text-faint)]">{optWarn ? '⚠ client is not opted in for that channel — send will be skipped' : 'client is opted in'}</span>
        <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !bodyText.trim()} onClick={send}>{busy ? 'Sending…' : 'Send now'}</button>
      </div>
      {err && <div class="mt-2 text-[12px] text-[var(--color-status-failed)]">{err}</div>}
    </div>
  );
}

function ActionLog({ actionLog }: { actionLog: AdminAction[] }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-text)]">
        <History size={14} class="text-[var(--color-accent)]" /> Admin action log
      </div>
      {actionLog.length === 0 ? (
        <div class="px-3 py-5 text-center text-[13px] text-[var(--color-text-faint)]">No admin edits logged yet.</div>
      ) : (
        <div class="max-h-[300px] overflow-y-auto">
          <div class="sticky top-0 z-10 hidden gap-1 border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] md:grid md:grid-cols-[170px_150px_1fr_90px]">
            <div>Admin</div><div>Field</div><div>Change</div><div class="text-right">When</div>
          </div>
          {actionLog.map((e) => (
            <div key={e.id} class="grid items-center gap-1 border-b border-[var(--color-border)] px-3 py-2.5 text-[12px] transition-colors last:border-b-0 hover:bg-[var(--color-elevated)] md:grid-cols-[170px_150px_1fr_90px]">
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
  const { busy: logRefreshing, spin: spinLog } = useSpin();
  const s = sched.data;
  const pill = (on: boolean, label: string) => (
    <span class={`rounded px-2 py-0.5 text-[12px] font-semibold ${on ? 'bg-[color-mix(in_srgb,var(--color-status-done)_18%,transparent)] text-[var(--color-status-done)]' : 'bg-[var(--color-elevated)] text-[var(--color-text-faint)]'}`}>{label}</span>
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
        ) : <div class="text-[13px] text-[var(--color-text-faint)]">Loading…</div>}
        <p class="mt-3 text-[12px] text-[var(--color-text-faint)]">Schedules are set on the massage server (env flags). SMS stays dry-run until a free provider is enabled. Per-appointment manual sends live on each account's Appointments panel.</p>
      </section>

      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <div class="text-[13px] font-semibold text-[var(--color-text)]">Send log</div>
          <button type="button" class={btnGhost} onClick={() => void spinLog(log.refresh)} disabled={logRefreshing} aria-busy={logRefreshing}>{logRefreshing ? <NestedSquaresSpinner size={11} /> : <RefreshCw size={11} />} refresh</button>
        </div>
        {(log.data?.messages ?? []).length === 0 ? (
          <div class="px-3 py-5 text-center text-[13px] text-[var(--color-text-faint)]">No messages sent yet.</div>
        ) : (
          <div class="max-h-[520px] overflow-y-auto">
            <div class="sticky top-0 z-10 hidden gap-1 border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] md:grid md:grid-cols-[70px_130px_1fr_110px_90px]">
              <div>Channel</div><div>Template</div><div>Recipient · subject</div><div>Status</div><div class="text-right">When</div>
            </div>
            {(log.data?.messages ?? []).map((m) => (
              <div key={m.id} class="grid items-center gap-1 border-b border-[var(--color-border)] px-3 py-2.5 text-[12px] transition-colors last:border-b-0 hover:bg-[var(--color-elevated)] md:grid-cols-[70px_130px_1fr_110px_90px]">
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
          <span class="text-[13px] text-[var(--color-text-muted)]">Mint gift certificate $</span>
          <input class={`${inputClass} w-24`} type="number" value={giftAmt} onInput={(e) => setGiftAmt((e.currentTarget as HTMLInputElement).value)} />
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={issueGift}>Issue gift</button>
        </div>
        {err && <div class="mt-2 text-[12px] text-[var(--color-status-failed)]">{err}</div>}
      </section>

      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="border-b border-[var(--color-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-text)]">{rows.length} codes</div>
        {rows.length === 0 ? <div class="px-3 py-5 text-center text-[13px] text-[var(--color-text-faint)]">No codes yet.</div> : (
          <div class="max-h-[520px] overflow-y-auto">
            <div class="sticky top-0 z-10 hidden gap-1 border-b border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] md:grid md:grid-cols-[130px_90px_1fr_120px_80px]">
              <div>Code</div><div>Value</div><div>Label · usage</div><div>Status</div><div></div>
            </div>
            {rows.map((c) => (
              <div key={c.code} class="grid items-center gap-1 border-b border-[var(--color-border)] px-3 py-2.5 text-[12px] transition-colors last:border-b-0 hover:bg-[var(--color-elevated)] md:grid-cols-[130px_90px_1fr_120px_80px]">
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

// ───────────────────────────────────────────────────────────── Availability ──
interface AvailabilityResp {
  ok: boolean;
  hours: Record<string, [string, string][]>;
  bookingWindowDays: number;
  maxAdvanceDays: number;
  slotIncrementMin?: number;
  bufferMin?: number;
  leadTimeHours?: number;
  blackouts: string[];
  timeBlocks?: TimeBlock[];
  bookingsPaused?: boolean;
}
interface TimeBlock { id: string; day: string; start_hm: string; end_hm: string }
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Week = Record<string, [string, string][]>;
// Ensure every weekday key (0..6) exists as an array of [open,close] pairs.
function normalizeWeek(h?: Record<string, [string, string][]>): Week {
  const w: Week = {};
  for (let d = 0; d <= 6; d++) {
    const r = h?.[String(d)];
    w[String(d)] = Array.isArray(r) ? r.map((x) => [String(x[0]), String(x[1])] as [string, string]) : [];
  }
  return w;
}
interface PendingAppt {
  id: string; client_name: string; client_email: string;
  service_name: string; appt_date: string; appt_time: string; created_at: string;
}
interface PendingResp { ok: boolean; pending: PendingAppt[] }

// Friendly "Mon, Jul 20" from a YYYY-MM-DD string (local, no TZ drift).
function fmtDay(d: string): string {
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return d; }
}

// Owner availability: block days off, set the self-serve booking window, and approve/decline
// the beyond-window request queue. Reads/writes the massage backend via the ClaudeClaw proxy.
function AvailabilityTab({ canEdit, pending }: { canEdit: boolean; pending: { data: PendingResp | null; refresh: () => void } }) {
  const avail = useFetch<AvailabilityResp>('/api/massage-admin/availability', 30000);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [windowDays, setWindowDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [week, setWeek] = useState<Week | null>(null);
  const [slotInc, setSlotInc] = useState('');
  const [buffer, setBuffer] = useState('');
  const [lead, setLead] = useState('');

  const cfg = avail.data;
  // Seed the window input from the loaded value once (leave user edits alone).
  useEffect(() => { if (cfg && windowDays === '') setWindowDays(String(cfg.bookingWindowDays)); }, [cfg?.bookingWindowDays]);
  // Seed the weekly-hours editor from the loaded config once.
  useEffect(() => {
    if (cfg && week === null) {
      setWeek(normalizeWeek(cfg.hours));
      setSlotInc(String(cfg.slotIncrementMin ?? 30));
      setBuffer(String(cfg.bufferMin ?? 15));
      setLead(String(cfg.leadTimeHours ?? 12));
    }
  }, [cfg]);

  function mutRange(d: number, i: number, idx: 0 | 1, val: string) {
    setWeek((w) => { if (!w) return w; const nw: Week = { ...w }; const rows = nw[String(d)].map((r) => [...r] as [string, string]); rows[i][idx] = val; nw[String(d)] = rows; return nw; });
  }
  function addRange(d: number) { setWeek((w) => { if (!w) return w; const nw: Week = { ...w }; nw[String(d)] = [...nw[String(d)], ['10:00', '17:00']]; return nw; }); }
  function removeRange(d: number, i: number) { setWeek((w) => { if (!w) return w; const nw: Week = { ...w }; nw[String(d)] = nw[String(d)].filter((_, j) => j !== i); return nw; }); }
  async function saveHours() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPut<{ ok?: boolean; error?: string }>('/api/massage-admin/availability/hours', { week, slotIncrementMin: Number(slotInc), bufferMin: Number(buffer), leadTimeHours: Number(lead) });
      if (r.ok === false) { setErr(r.error || 'failed'); return; }
      avail.refresh();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function addBlackout() {
    if (!start) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ ok?: boolean; error?: string; count?: number }>('/api/massage-admin/availability/blackout', { start, end: end || undefined });
      if (r.ok === false) { setErr(r.error || 'failed'); return; }
      setStart(''); setEnd(''); avail.refresh();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function removeDay(day: string) {
    setBusy(true); setErr(null);
    try { await apiDelete(`/api/massage-admin/availability/blackout/${day}`); avail.refresh(); }
    catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function saveWindow() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPut<{ ok?: boolean; error?: string }>('/api/massage-admin/availability/window', { bookingWindowDays: Number(windowDays) });
      if (r.ok === false) { setErr(r.error || 'failed'); return; }
      avail.refresh();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function decide(id: string, action: 'approve' | 'decline') {
    setBusy(true); setErr(null);
    try { await apiPost(`/api/massage-admin/availability/pending/${id}/${action}`, {}); pending.refresh(); avail.refresh(); }
    catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  // The schedule calendar (Month / Week / 3-day / Day) owns its own fetching; any
  // mutation here just drops its cached months so it repaints with the new truth.
  const refreshSchedule = () => invalidateFetchCache('/api/massage-admin/availability/schedule');

  // Partial-day block inputs.
  const [tbDay, setTbDay] = useState('');
  const [tbStart, setTbStart] = useState('12:00');
  const [tbEnd, setTbEnd] = useState('13:00');

  const paused = !!cfg?.bookingsPaused;
  async function togglePause() {
    setBusy(true); setErr(null);
    try { await apiPut('/api/massage-admin/availability/pause', { paused: !paused }); avail.refresh(); }
    catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function quickBlock(range: 'today' | 'week') {
    setBusy(true); setErr(null);
    try {
      const today = new Date();
      const start = isoLocalDate(today);
      let end: string | undefined;
      if (range === 'week') { const s = new Date(today); s.setDate(s.getDate() + ((7 - s.getDay()) % 7)); end = isoLocalDate(s); } // through the coming Sunday
      await apiPost('/api/massage-admin/availability/blackout', { start, end });
      avail.refresh(); refreshSchedule();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function addTimeBlock() {
    if (!tbDay) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ ok?: boolean; error?: string }>('/api/massage-admin/availability/timeblock', { day: tbDay, start: tbStart, end: tbEnd });
      if (r.ok === false) { setErr(r.error || 'failed'); return; }
      setTbDay(''); avail.refresh(); refreshSchedule();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function removeTimeBlock(id: string) {
    setBusy(true); setErr(null);
    try { await apiDelete(`/api/massage-admin/availability/timeblock/${id}`); avail.refresh(); refreshSchedule(); }
    catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  const blackouts = cfg?.blackouts ?? [];
  const timeBlocks = cfg?.timeBlocks ?? [];
  const reqs = pending.data?.pending ?? [];

  return (
    <div class="space-y-4">
      {/* Quick actions */}
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
        <h3 class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text)]"><CalendarClock size={14} class="text-[var(--color-accent)]" /> Quick actions</h3>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={() => quickBlock('today')}><Plus size={12} /> Out today</button>
          <button type="button" class={btnGhost} disabled={!canEdit || busy} onClick={() => quickBlock('week')}><Plus size={12} /> Block rest of this week</button>
          <button type="button" class={paused ? btnAccent : btnGhost} style={paused ? 'background:var(--color-accent)' : ''} disabled={!canEdit || busy} onClick={togglePause}>{paused ? '▶ Resume online bookings' : '⏸ Pause all new bookings'}</button>
        </div>
        {paused && <div class="mt-2 text-[12px] font-semibold text-[var(--color-status-failed)]">Online booking is PAUSED — clients can’t submit new requests until you resume.</div>}
      </section>

      {/* Schedule — Month / Week / 3-day / Day */}
      <ScheduleCalendar selectedDay={tbDay} onPickDay={setTbDay} />

      {/* Booking window */}
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
        <h3 class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text)]"><CalendarClock size={14} class="text-[var(--color-accent)]" /> Booking window</h3>
        <p class="mb-3 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
          Clients can book any open day within this many days. Beyond it (up to {cfg?.maxAdvanceDays ?? 365} days) they can only
          <span class="font-semibold text-[var(--color-text)]"> request</span> a date — it lands in the queue below for you to approve.
        </p>
        <div class="flex items-center gap-2">
          <input class={`${inputClass} w-24`} type="number" min={1} max={365} value={windowDays} onInput={(e) => setWindowDays((e.currentTarget as HTMLInputElement).value)} />
          <span class="text-[13px] text-[var(--color-text-muted)]">days self-serve</span>
          <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !windowDays} onClick={saveWindow}><Save size={12} /> Save window</button>
        </div>
      </section>

      {/* Weekly working hours */}
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
        <h3 class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text)]"><CalendarClock size={14} class="text-[var(--color-accent)]" /> Weekly hours</h3>
        <p class="mb-3 text-[13px] leading-relaxed text-[var(--color-text-muted)]">Your normal working days &amp; hours. A day with no time ranges is closed. Add a range to open a day (e.g. a Saturday); add two ranges for a lunch break. Changes apply immediately.</p>
        <div class="space-y-1.5">
          {week && DAY_NAMES.map((name, d) => {
            const ranges = week[String(d)] || [];
            return (
              <div key={d} class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] py-1.5 last:border-b-0">
                <span class="w-9 text-[13px] font-semibold text-[var(--color-text)]">{name}</span>
                {ranges.length === 0 && <span class="text-[12px] text-[var(--color-text-faint)]">Closed</span>}
                {ranges.map((r, i) => (
                  <span key={i} class="inline-flex items-center gap-1">
                    <input class={`${inputClass} w-24`} type="time" value={r[0]} onInput={(e) => mutRange(d, i, 0, (e.currentTarget as HTMLInputElement).value)} />
                    <span class="text-[12px] text-[var(--color-text-faint)]">–</span>
                    <input class={`${inputClass} w-24`} type="time" value={r[1]} onInput={(e) => mutRange(d, i, 1, (e.currentTarget as HTMLInputElement).value)} />
                    <button type="button" title="Remove range" class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)] disabled:opacity-40" disabled={!canEdit || busy} onClick={() => removeRange(d, i)}><X size={12} /></button>
                  </span>
                ))}
                <button type="button" class="inline-flex items-center gap-0.5 text-[12px] text-[var(--color-accent)] hover:underline disabled:opacity-40" disabled={!canEdit || busy} onClick={() => addRange(d)}><Plus size={11} /> hours</button>
              </div>
            );
          })}
        </div>
        <div class="mt-3 flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] pt-3">
          <label class="text-[12px] text-[var(--color-text-muted)]">Slot step (min)<br /><input class={`${inputClass} w-20`} type="number" min={5} max={240} value={slotInc} onInput={(e) => setSlotInc((e.currentTarget as HTMLInputElement).value)} /></label>
          <label class="text-[12px] text-[var(--color-text-muted)]">Buffer (min)<br /><input class={`${inputClass} w-20`} type="number" min={0} max={120} value={buffer} onInput={(e) => setBuffer((e.currentTarget as HTMLInputElement).value)} /></label>
          <label class="text-[12px] text-[var(--color-text-muted)]">Lead time (hrs)<br /><input class={`${inputClass} w-20`} type="number" min={0} max={168} value={lead} onInput={(e) => setLead((e.currentTarget as HTMLInputElement).value)} /></label>
          <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !week} onClick={saveHours}><Save size={12} /> Save hours</button>
        </div>
      </section>

      {/* Days off */}
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
        <h3 class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text)]"><CalendarClock size={14} class="text-[var(--color-accent)]" /> Days off</h3>
        <p class="mb-3 text-[13px] leading-relaxed text-[var(--color-text-muted)]">Blocked days show no open times to clients. Leave the end date empty for a single day, or set it for a range (vacation).</p>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-[12px] text-[var(--color-text-muted)]">From <input class={inputClass} type="date" value={start} onInput={(e) => setStart((e.currentTarget as HTMLInputElement).value)} /></label>
          <label class="text-[12px] text-[var(--color-text-muted)]">To (optional) <input class={inputClass} type="date" value={end} onInput={(e) => setEnd((e.currentTarget as HTMLInputElement).value)} /></label>
          <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !start} onClick={addBlackout}><Plus size={12} /> Block</button>
        </div>
        {err && <div class="mt-2 text-[12px] text-[var(--color-status-failed)]">{err}</div>}
        <div class="mt-3 border-t border-[var(--color-border)] pt-3">
          {blackouts.length === 0 ? <div class="text-[13px] text-[var(--color-text-faint)]">No days off scheduled.</div> : (
            <div class="flex flex-wrap gap-2">
              {blackouts.map((d) => (
                <span key={d} class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-text)]">
                  {fmtDay(d)}
                  <button type="button" title="Remove" class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)] disabled:opacity-40" disabled={!canEdit || busy} onClick={() => removeDay(d)}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Partial-day blocks — block a time range within a day (day stays otherwise bookable). */}
        <div class="mt-3 border-t border-[var(--color-border)] pt-3">
          <div class="mb-2 text-[13px] font-semibold text-[var(--color-text)]">Partial-day blocks</div>
          <p class="mb-2 text-[12px] text-[var(--color-text-muted)]">Block just part of a day (e.g. an errand 2–5pm) — the rest of the day stays bookable.</p>
          <div class="flex flex-wrap items-end gap-2">
            <label class="text-[12px] text-[var(--color-text-muted)]">Day<br /><input class={inputClass} type="date" value={tbDay} onInput={(e) => setTbDay((e.currentTarget as HTMLInputElement).value)} /></label>
            <label class="text-[12px] text-[var(--color-text-muted)]">From<br /><input class={`${inputClass} w-24`} type="time" value={tbStart} onInput={(e) => setTbStart((e.currentTarget as HTMLInputElement).value)} /></label>
            <label class="text-[12px] text-[var(--color-text-muted)]">To<br /><input class={`${inputClass} w-24`} type="time" value={tbEnd} onInput={(e) => setTbEnd((e.currentTarget as HTMLInputElement).value)} /></label>
            <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy || !tbDay} onClick={addTimeBlock}><Plus size={12} /> Block time</button>
          </div>
          {timeBlocks.length > 0 && (
            <div class="mt-2 flex flex-wrap gap-2">
              {timeBlocks.map((t) => (
                <span key={t.id} class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-text)]">
                  {fmtDay(t.day)} {t.start_hm}–{t.end_hm}
                  <button type="button" title="Remove" class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)] disabled:opacity-40" disabled={!canEdit || busy} onClick={() => removeTimeBlock(t.id)}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Beyond-window request queue */}
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="border-b border-[var(--color-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-text)]">Requests awaiting approval ({reqs.length})</div>
        {reqs.length === 0 ? <div class="px-3 py-5 text-center text-[13px] text-[var(--color-text-faint)]">No beyond-window requests right now.</div> : (
          <div class="max-h-[420px] overflow-y-auto">
            {reqs.map((r) => (
              <div key={r.id} class="grid items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5 text-[12px] transition-colors last:border-b-0 hover:bg-[var(--color-elevated)] md:grid-cols-[1fr_150px_auto]">
                <div>
                  <div class="font-semibold text-[var(--color-text)]">{r.client_name} <span class="font-normal text-[var(--color-text-faint)]">· {r.client_email}</span></div>
                  <div class="text-[var(--color-text-muted)]">{r.service_name}</div>
                </div>
                <div class="text-[var(--color-text-muted)]">{fmtDay(r.appt_date)} at {r.appt_time}</div>
                <div class="flex items-center gap-2">
                  <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit || busy} onClick={() => decide(r.id, 'approve')}><Check size={12} /> Approve</button>
                  <button type="button" class={btnDanger} disabled={!canEdit || busy} onClick={() => decide(r.id, 'decline')}><X size={12} /> Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────── Intake + SOAP data ──
// Region vocabulary reused from the public intake body-map (config/intake.json):
// general always-worked regions first, then the consent-gated ones.
const SOAP_REGIONS = ['Neck', 'Shoulders', 'Back', 'Arms & Hands', 'Legs', 'Scalp', 'Face', 'Pectoral Muscles', 'Abdomen', 'Gluteal Region', 'Feet'];
const SOAP_TECHNIQUES = ['Swedish', 'Deep tissue', 'Trigger point', 'Myofascial release', 'Cupping', 'Hot stone', 'Stretching', 'Sports', 'Prenatal', 'Lymphatic'];
const SOAP_POSITIONS = ['supine', 'prone', 'side-lying', 'seated'];
const SOAP_PRESSURES = ['light', 'medium', 'deep'];

interface IntakeRow {
  id: string; appointment_id: string | null; submitted_at: string;
  reviewed_at: string | null; reviewed_by: string | null; has_signature: number;
  client_name: string | null; client_email: string | null; user_id: string | null;
  service_name: string | null; appt_date: string | null; appt_time: string | null;
}
interface IntakeFlag { label: string; value: string }
interface IntakeDetail {
  ok: boolean; error?: string;
  intake: IntakeRow; html: string; flags: Record<string, IntakeFlag>;
}
interface AreaConcern { region: string; severity: number; findings?: string; focus?: boolean }
interface NextFocus { region: string; note?: string }
interface SoapNote {
  id: string; appointment_id: string | null; user_id: string | null; client_email: string | null;
  session_date: string | null; created_at: string; updated_at: string | null; author: string | null;
  pain_before: number | null; pain_after: number | null; position: string | null; pressure: string | null;
  duration_min: number | null; techniques: string[]; areas_concern: AreaConcern[];
  subjective: string | null; objective: string | null; assessment: string | null; plan: string | null;
  home_care: string | null; next_focus: NextFocus[]; referrals: string | null;
  adverse_reactions: string | null; flags: Record<string, IntakeFlag> | unknown;
}
interface CarryForward { next_focus: NextFocus[]; last_note_id: string | null; flags: Record<string, IntakeFlag> }
interface SoapClientResp {
  ok: boolean; notes: SoapNote[];
  trend: { regions: Record<string, { date: string; severity: number; note_id: string }[]>; pain: { date: string; before: number | null; after: number | null; note_id: string }[] };
  carry_forward: CarryForward;
}

// ─────────────────────────────────────────────────────────── Intake Forms ──
function IntakesTab({ canEdit }: { canEdit: boolean }) {
  const list = useFetch<{ intakes: IntakeRow[] }>('/api/massage-admin/intakes', 30000);
  const [query, setQuery] = useState('');
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const intakes = list.data?.intakes ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = intakes;
    if (q) rows = rows.filter((i) => `${i.client_name ?? ''} ${i.client_email ?? ''} ${i.service_name ?? ''}`.toLowerCase().includes(q));
    if (onlyUnreviewed) rows = rows.filter((i) => !i.reviewed_at);
    return rows;
  }, [intakes, query, onlyUnreviewed]);

  useEffect(() => { if (!selectedId && filtered[0]) setSelectedId(filtered[0].id); }, [filtered, selectedId]);

  return (
    <div class="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <input class={`${inputClass} py-1.5`} placeholder="Search client / email / service" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
          <label class="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
            <input type="checkbox" checked={onlyUnreviewed} onChange={(e) => setOnlyUnreviewed((e.currentTarget as HTMLInputElement).checked)} /> Unreviewed only
          </label>
          <span class="text-[11px] text-[var(--color-text-faint)]">{filtered.length} of {intakes.length}</span>
        </div>
        {list.loading && !list.data && <div class="px-3 py-6 text-center text-[13px] text-[var(--color-text-faint)]">Loading…</div>}
        <div class="max-h-[620px] overflow-y-auto">
          {filtered.map((i) => (
            <button key={i.id} type="button" onClick={() => setSelectedId(i.id)}
              class={`flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-left transition-colors last:border-b-0 ${selectedId === i.id ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'hover:bg-[var(--color-elevated)]'}`}>
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)]">
                <ClipboardList size={15} class="text-[var(--color-accent)]" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-[14px] font-semibold text-[var(--color-text)]">{i.client_name || i.client_email || '(guest)'}</span>
                  {i.reviewed_at
                    ? <span class="ml-auto rounded bg-[color-mix(in_srgb,var(--color-status-done)_18%,transparent)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-status-done)]">reviewed</span>
                    : <span class="ml-auto rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-warn)]">new</span>}
                </span>
                <span class="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{i.client_email || '—'}</span>
                <span class="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">
                  {i.service_name || 'intake'}{i.appt_date ? ` · ${i.appt_date} ${i.appt_time ?? ''}` : ''} · submitted {agoFromIso(i.submitted_at)}
                </span>
              </span>
            </button>
          ))}
          {!list.loading && filtered.length === 0 && <div class="px-3 py-6 text-center text-[13px] text-[var(--color-text-faint)]">No intake forms.</div>}
        </div>
      </aside>
      <main>{selectedId ? <IntakeViewer id={selectedId} canEdit={canEdit} onReviewed={() => list.refresh()} /> : <div class="rounded-lg border border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-faint)]">Select an intake to review.</div>}</main>
    </div>
  );
}

function IntakeViewer({ id, canEdit, onReviewed }: { id: string; canEdit: boolean; onReviewed: () => void }) {
  const [detail, setDetail] = useState<IntakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null); setDetail(null);
    apiGet<IntakeDetail>(`/api/massage-admin/intakes/${encodeURIComponent(id)}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setErr(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  async function markReviewed() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ ok?: boolean; error?: string; reviewed_at?: string; reviewed_by?: string }>(`/api/massage-admin/intakes/${encodeURIComponent(id)}/reviewed`);
      if (r.error || r.ok === false) { setErr(r.error || 'failed'); return; }
      setDetail((d) => d ? { ...d, intake: { ...d.intake, reviewed_at: r.reviewed_at ?? new Date().toISOString(), reviewed_by: r.reviewed_by ?? null } } : d);
      onReviewed();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div class="rounded-lg border border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-faint)]">Loading intake…</div>;
  if (err && !detail) return <div class="rounded-lg border border-[var(--color-status-failed)] px-4 py-4 text-[13px] text-[var(--color-status-failed)]">{err}</div>;
  if (!detail) return null;
  const flags = Object.values(detail.flags || {});
  const i = detail.intake;

  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-[15px] font-semibold text-[var(--color-text)]">{i.client_name || i.client_email || '(guest intake)'}</h2>
          <div class="mt-1 flex flex-wrap gap-x-3 text-[12px] text-[var(--color-text-faint)]">
            <span>{i.service_name || 'intake'}{i.appt_date ? ` · ${i.appt_date} ${i.appt_time ?? ''}` : ''}</span>
            <span>· submitted {agoFromIso(i.submitted_at)}</span>
            {i.reviewed_at
              ? <span class="text-[var(--color-status-done)]">· reviewed {agoFromIso(i.reviewed_at)}{i.reviewed_by ? ` by ${i.reviewed_by}` : ''}</span>
              : <span class="text-[var(--color-warn)]">· not reviewed</span>}
          </div>
        </div>
        <button type="button" class={i.reviewed_at ? btnGhost : btnAccent} style={i.reviewed_at ? '' : 'background:var(--color-accent)'} disabled={busy || !canEdit || !!i.reviewed_at} onClick={markReviewed}>
          <Check size={13} /> {i.reviewed_at ? 'Reviewed' : busy ? 'Marking…' : 'Mark reviewed'}
        </button>
      </div>
      {flags.length > 0 && (
        <div class="mb-3 rounded-md border border-[var(--color-warn)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
          <span class="font-semibold">⚠ Safety flags:</span> {flags.map((f) => `${f.label}: ${f.value}`).join(' · ')}
        </div>
      )}
      {err && <div class="mb-3 text-[12px] text-[var(--color-status-failed)]">{err}</div>}
      {/* Rendered intake (reuses the massage server's reviewHtml). */}
      <div class="intake-review overflow-x-auto text-[13px] text-[var(--color-text)]" dangerouslySetInnerHTML={{ __html: detail.html }} />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── SOAP tab ──
function SoapTab({ overview, canEdit }: { overview: ReturnType<typeof useFetch<Overview>>; canEdit: boolean }) {
  const clients = overview.data?.clients ?? [];
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? clients.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)) : clients;
    return [...rows].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [clients, query]);

  const selected = clients.find((c) => c.id === clientId) ?? null;

  return (
    <div class="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <input class={`${inputClass} py-1.5`} placeholder="Find client for notes" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="max-h-[640px] overflow-y-auto">
          {filtered.map((c) => (
            <button key={c.id} type="button" onClick={() => setClientId(c.id)}
              class={`flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-left transition-colors last:border-b-0 ${clientId === c.id ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'hover:bg-[var(--color-elevated)]'}`}>
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)]">
                <Stethoscope size={15} class="text-[var(--color-accent)]" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[14px] font-semibold text-[var(--color-text)]">{c.name || c.email}</span>
                <span class="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{c.email}</span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div class="px-3 py-6 text-center text-[13px] text-[var(--color-text-faint)]">No matching clients.</div>}
        </div>
      </aside>
      <main>{selected ? <SoapClientPanel key={selected.id} client={selected} canEdit={canEdit} /> : <div class="rounded-lg border border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-faint)]">Select a client to view their SOAP notes over time.</div>}</main>
    </div>
  );
}

function SoapClientPanel({ client, canEdit }: { client: MassageClient; canEdit: boolean }) {
  const soap = useFetch<SoapClientResp>(`/api/massage-admin/soap?client=${encodeURIComponent(client.id)}`, 0);
  const appts = useFetch<{ appointments: Appointment[] }>(`/api/massage-admin/clients/${encodeURIComponent(client.id)}/appointments`, 0);
  const [mode, setMode] = useState<'timeline' | 'new' | { edit: SoapNote } | { dup: SoapNote }>('timeline');

  const notes = soap.data?.notes ?? [];
  const trend = soap.data?.trend;
  const cf = soap.data?.carry_forward;

  const refreshAll = () => { soap.refresh(); setMode('timeline'); };

  if (mode !== 'timeline') {
    const existing = typeof mode === 'object' && 'edit' in mode ? mode.edit : null;
    const seed = typeof mode === 'object' && 'dup' in mode ? mode.dup : null;
    return (
      <SoapForm
        client={client}
        appointments={appts.data?.appointments ?? []}
        existing={existing}
        seed={seed}
        history={notes}
        carryForward={existing ? null : (cf ?? null)}
        canEdit={canEdit}
        onCancel={() => setMode('timeline')}
        onSaved={refreshAll}
      />
    );
  }

  return (
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-[15px] font-semibold text-[var(--color-text)]">{client.name || client.email} · SOAP timeline</h2>
        <div class="flex items-center gap-2">
          {notes.length > 0 && <button type="button" class={btnGhost} disabled={!canEdit} onClick={() => setMode({ dup: notes[0] })}><Copy size={13} /> Duplicate last</button>}
          <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit} onClick={() => setMode('new')}><Plus size={13} /> New note</button>
        </div>
      </div>

      {cf && (Object.keys(cf.flags || {}).length > 0 || (cf.next_focus?.length ?? 0) > 0) && (
        <div class="rounded-lg border border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] px-4 py-3 text-[12px]">
          {Object.keys(cf.flags || {}).length > 0 && (
            <div class="text-[var(--color-warn)]"><span class="font-semibold">⚠ Intake safety flags:</span> {Object.values(cf.flags).map((f) => `${f.label}: ${f.value}`).join(' · ')}</div>
          )}
          {(cf.next_focus?.length ?? 0) > 0 && (
            <div class="mt-1 text-[var(--color-text-muted)]"><span class="font-semibold text-[var(--color-accent)]">Focus next session:</span> {cf.next_focus.map((n) => n.region + (n.note ? ` (${n.note})` : '')).join(' · ')}</div>
          )}
        </div>
      )}

      {trend && (notes.length > 0) && <TissueTrend trend={trend} />}

      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        <div class="border-b border-[var(--color-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-text)]">{notes.length} note{notes.length === 1 ? '' : 's'}</div>
        {soap.loading && !soap.data && <div class="px-3 py-6 text-center text-[13px] text-[var(--color-text-faint)]">Loading…</div>}
        {!soap.loading && notes.length === 0 && <div class="px-3 py-6 text-center text-[13px] text-[var(--color-text-faint)]">No SOAP notes yet. Create the first one.</div>}
        <div class="max-h-[560px] overflow-y-auto">
          {notes.map((n) => (
            <button key={n.id} type="button" onClick={() => canEdit && setMode({ edit: n })}
              class="block w-full border-b border-[var(--color-border)] px-3 py-3 text-left last:border-b-0 hover:bg-[var(--color-elevated)]">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span class="text-[13px] font-semibold text-[var(--color-text)]">{n.session_date || (n.created_at || '').slice(0, 10)}</span>
                {(n.pain_before != null || n.pain_after != null) && (
                  <span class="text-[12px] text-[var(--color-text-muted)]">pain {n.pain_before ?? '—'} → <span class="text-[var(--color-status-done)]">{n.pain_after ?? '—'}</span></span>
                )}
                {n.pressure && <span class="text-[12px] text-[var(--color-text-faint)]">· {n.pressure}</span>}
                {n.duration_min ? <span class="text-[12px] text-[var(--color-text-faint)]">· {n.duration_min}m</span> : null}
                {n.author && <span class="ml-auto text-[11px] text-[var(--color-text-faint)]">{n.author}</span>}
              </div>
              {n.techniques?.length > 0 && <div class="mt-1 text-[12px] text-[var(--color-text-muted)]">{n.techniques.join(', ')}</div>}
              {n.areas_concern?.length > 0 && (
                <div class="mt-1 flex flex-wrap gap-1">
                  {n.areas_concern.map((a, idx) => (
                    <span key={idx} class="rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">{a.region} <span class="text-[var(--color-warn)]">{a.severity}</span>{a.focus ? ' ★' : ''}</span>
                  ))}
                </div>
              )}
              {n.assessment && <div class="mt-1 truncate text-[12px] text-[var(--color-text-faint)]">A: {n.assessment}</div>}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// Per-region severity + pain before/after over time, drawn as compact inline bars.
function TissueTrend({ trend }: { trend: SoapClientResp['trend'] }) {
  const regions = Object.entries(trend.regions || {}).filter(([, pts]) => pts.length > 0);
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]"><Activity size={12} /> Tissue trend over time</div>
      {trend.pain.length > 0 && (
        <div class="mb-3">
          <div class="mb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">Pain before → after</div>
          <div class="flex flex-wrap gap-2">
            {trend.pain.map((p, i) => (
              <div key={i} class="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text-faint)]">{p.date}</span>{' '}
                <span>{p.before ?? '—'}</span> → <span class="text-[var(--color-status-done)]">{p.after ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {regions.length > 0 && (
        <div class="space-y-1.5">
          {regions.map(([region, pts]) => (
            <div key={region} class="flex items-center gap-2">
              <div class="w-28 shrink-0 truncate text-[12px] text-[var(--color-text-muted)]">{region}</div>
              <div class="flex flex-1 items-end gap-1" style="height:28px">
                {pts.map((pt, i) => (
                  <div key={i} class="flex flex-col items-center justify-end" title={`${pt.date}: ${pt.severity}/10`}>
                    <div class="w-3 rounded-t bg-[var(--color-accent)]" style={`height:${Math.max(2, (Number(pt.severity) || 0) * 2.4)}px`} />
                  </div>
                ))}
              </div>
              <div class="w-8 shrink-0 text-right text-[11px] text-[var(--color-text-faint)]">{pts[pts.length - 1]?.severity ?? '—'}</div>
            </div>
          ))}
        </div>
      )}
      {regions.length === 0 && trend.pain.length === 0 && <div class="text-[12px] text-[var(--color-text-faint)]">Trend appears once notes carry per-region severity.</div>}
    </section>
  );
}

// The structured SOAP form (create or edit). Areas-of-concern body-map + carry-forward.
function SoapForm({ client, appointments, existing, seed, history, carryForward, canEdit, onCancel, onSaved }: {
  client: MassageClient; appointments: Appointment[]; existing: SoapNote | null;
  seed?: SoapNote | null; history?: SoapNote[]; carryForward: CarryForward | null; canEdit: boolean; onCancel: () => void; onSaved: () => void;
}) {
  // Per-client autofill: distinct non-empty values this client had in earlier notes, most-recent
  // first. Excludes the note being edited so you never "reuse" its own current value. Powers the
  // per-field "↺ reuse…" pickers (Field prop) so repeat clients don't mean repeat typing.
  const priorNotes = (history ?? []).filter((n) => n.id !== existing?.id);
  const priorVals = (get: (n: SoapNote) => unknown): string[] => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const n of priorNotes) {
      const raw = get(n);
      const v = raw == null ? '' : String(raw).trim();
      if (!v || seen.has(v)) continue;
      seen.add(v); out.push(v);
      if (out.length >= 8) break;
    }
    return out;
  };
  const today = new Date().toISOString().slice(0, 10);
  // Clinical content is seeded from the note being edited OR the note being duplicated.
  // Session-specific fields (date, appointment) always start fresh for a duplicate.
  const src = existing ?? seed ?? null;
  const [apptId, setApptId] = useState<string>(existing?.appointment_id || '');
  const [sessionDate, setSessionDate] = useState<string>(existing?.session_date || today);
  const [painBefore, setPainBefore] = useState<string>(src?.pain_before != null ? String(src.pain_before) : '');
  const [painAfter, setPainAfter] = useState<string>(src?.pain_after != null ? String(src.pain_after) : '');
  const [position, setPosition] = useState<string>(src?.position || '');
  const [pressure, setPressure] = useState<string>(src?.pressure || '');
  const [duration, setDuration] = useState<string>(src?.duration_min != null ? String(src.duration_min) : '');
  const [techniques, setTechniques] = useState<string[]>(src?.techniques || []);
  // Seed the body-map from the source note, else from the carry-forward focus regions.
  const [areas, setAreas] = useState<AreaConcern[]>(() => {
    if (src?.areas_concern?.length) return src.areas_concern.map((a) => ({ ...a }));
    if (carryForward?.next_focus?.length) return carryForward.next_focus.map((n) => ({ region: n.region, severity: 0, findings: n.note || '', focus: false }));
    return [];
  });
  const [subjective, setSubjective] = useState(src?.subjective || '');
  const [objective, setObjective] = useState(src?.objective || '');
  const [assessment, setAssessment] = useState(src?.assessment || '');
  const [plan, setPlan] = useState(src?.plan || '');
  const [homeCare, setHomeCare] = useState(src?.home_care || '');
  const [referrals, setReferrals] = useState(src?.referrals || '');
  const [adverse, setAdverse] = useState(src?.adverse_reactions || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleTechnique(t: string) {
    setTechniques((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }
  const flags = (existing ? existing.flags : (seed?.flags ?? carryForward?.flags)) as Record<string, IntakeFlag> || {};

  // When an appointment is chosen, default the session date to its date.
  function pickAppt(id: string) {
    setApptId(id);
    const a = appointments.find((x) => x.id === id);
    if (a && !existing) setSessionDate(a.appt_date || today);
  }

  async function save() {
    setBusy(true); setErr(null);
    const nextFocus = areas.filter((a) => a.focus).map((a) => ({ region: a.region, note: a.findings || '' }));
    const payload: Record<string, unknown> = {
      appointment_id: apptId || null,
      session_date: sessionDate || today,
      pain_before: painBefore === '' ? null : Number(painBefore),
      pain_after: painAfter === '' ? null : Number(painAfter),
      position: position || null,
      pressure: pressure || null,
      duration_min: duration === '' ? null : Number(duration),
      techniques,
      areas_concern: areas,
      subjective, objective, assessment, plan,
      home_care: homeCare, next_focus: nextFocus,
      referrals, adverse_reactions: adverse,
      flags,
    };
    if (!existing) { payload.user_id = client.id; payload.client_email = client.email; }
    try {
      const r = existing
        ? await apiPatch<{ ok?: boolean; error?: string }>(`/api/massage-admin/soap/${encodeURIComponent(existing.id)}`, payload)
        : await apiPost<{ ok?: boolean; error?: string }>('/api/massage-admin/soap', payload);
      if (r.error || r.ok === false) { setErr(r.error || 'save failed'); return; }
      onSaved();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-[14px] font-semibold text-[var(--color-text)]">{existing ? 'Edit SOAP note' : seed ? 'Duplicate note' : 'New SOAP note'} · {client.name || client.email}</h3>
        <button type="button" class={btnGhost} onClick={onCancel}><X size={13} /> Close</button>
      </div>
      <div class="mb-3 text-[12px] text-[var(--color-text-faint)]">Private clinical note — the client never sees this.</div>

      {Object.keys(flags || {}).length > 0 && (
        <div class="mb-3 rounded-md border border-[var(--color-warn)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
          <span class="font-semibold">⚠ Intake safety flags:</span> {Object.values(flags).map((f) => `${f.label}: ${f.value}`).join(' · ')}
        </div>
      )}
      {seed && (
        <div class="mb-3 rounded-md border border-[var(--color-accent)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
          <span class="font-semibold text-[var(--color-accent)]">Duplicated from</span> the {seed.session_date || (seed.created_at || '').slice(0, 10)} note — clinical fields pre-filled; date reset to today. Adjust what changed and save as a new note.
        </div>
      )}
      {!existing && !seed && (carryForward?.next_focus?.length ?? 0) > 0 && (
        <div class="mb-3 rounded-md border border-[var(--color-accent)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
          <span class="font-semibold text-[var(--color-accent)]">Carried forward:</span> {carryForward!.next_focus.map((n) => n.region + (n.note ? ` (${n.note})` : '')).join(' · ')} — pre-loaded into the body-map below.
        </div>
      )}

      <div class="grid gap-3 md:grid-cols-3">
        <Field label="Appointment (optional)">
          <select class={inputClass} value={apptId} onChange={(e) => pickAppt((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">— none —</option>
            {appointments.map((a) => <option key={a.id} value={a.id}>{a.appt_date} {a.appt_time} · {a.service_name}</option>)}
          </select>
        </Field>
        <Field label="Session date"><input type="date" class={inputClass} value={sessionDate} onInput={(e) => setSessionDate((e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Duration (min)" prior={priorVals((n) => n.duration_min)} onPick={setDuration}><input type="number" class={inputClass} value={duration} onInput={(e) => setDuration((e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Pain before (0-10)" prior={priorVals((n) => n.pain_before)} onPick={setPainBefore}><input type="number" min="0" max="10" class={inputClass} value={painBefore} onInput={(e) => setPainBefore((e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Pain after (0-10)" prior={priorVals((n) => n.pain_after)} onPick={setPainAfter}><input type="number" min="0" max="10" class={inputClass} value={painAfter} onInput={(e) => setPainAfter((e.currentTarget as HTMLInputElement).value)} /></Field>
        <Field label="Position" prior={priorVals((n) => n.position)} onPick={setPosition}>
          <select class={inputClass} value={position} onChange={(e) => setPosition((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">—</option>{SOAP_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Pressure" prior={priorVals((n) => n.pressure)} onPick={setPressure}>
          <select class={inputClass} value={pressure} onChange={(e) => setPressure((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">—</option>{SOAP_PRESSURES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>

      <div class="mt-4">
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Techniques</div>
        <div class="flex flex-wrap gap-1.5">
          {SOAP_TECHNIQUES.map((t) => (
            <button key={t} type="button" onClick={() => toggleTechnique(t)}
              class={`rounded-md border px-2 py-1 text-[12px] ${techniques.includes(t) ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <BodyMapPicker areas={areas} onChange={setAreas} />

      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <NoteField label="Subjective (client reports)" phraseKey="subjective" value={subjective} onChange={setSubjective} prior={priorVals((n) => n.subjective)} />
        <NoteField label="Objective (findings)" phraseKey="objective" value={objective} onChange={setObjective} prior={priorVals((n) => n.objective)} />
        <NoteField label="Assessment" phraseKey="assessment" value={assessment} onChange={setAssessment} prior={priorVals((n) => n.assessment)} />
        <NoteField label="Plan" phraseKey="plan" value={plan} onChange={setPlan} prior={priorVals((n) => n.plan)} />
        <NoteField label="Home care (self-care given)" phraseKey="home_care" value={homeCare} onChange={setHomeCare} prior={priorVals((n) => n.home_care)} />
        <NoteField label="Referrals" phraseKey="referrals" value={referrals} onChange={setReferrals} prior={priorVals((n) => n.referrals)} />
        <div class="md:col-span-2"><NoteField label="Adverse reactions" phraseKey="adverse_reactions" value={adverse} onChange={setAdverse} prior={priorVals((n) => n.adverse_reactions)} /></div>
      </div>

      {err && <div class="mt-3 text-[12px] text-[var(--color-status-failed)]">{err}</div>}
      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class={btnGhost} onClick={onCancel}>Cancel</button>
        <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={busy || !canEdit} onClick={save}><Save size={13} /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Save note'}</button>
      </div>
    </section>
  );
}

// Areas-of-concern body-map: add regions, set 0-10 severity + findings, flag "focus next session".
// Marker placement (% of the 848×1264 figure art, center-anchored) + short labels. Bilateral
// regions (arms/legs/shoulders) sit on a representative side so the dots don't pile up center.
const SOAP_REGION_POS: Record<string, { front?: [number, number]; back?: [number, number] }> = {
  'Scalp':            { front: [50, 6],  back: [50, 6] },
  'Face':             { front: [50, 12] },
  'Neck':             { front: [50, 17], back: [50, 15] },
  'Shoulders':        { front: [69, 20], back: [69, 21] },
  'Pectoral Muscles': { front: [50, 27] },
  'Back':             { back: [50, 33] },
  'Arms & Hands':     { front: [24, 44], back: [78, 45] },
  'Abdomen':          { front: [50, 39] },
  'Gluteal Region':   { back: [50, 47] },
  'Legs':             { front: [42, 70], back: [58, 66] },
  'Feet':             { front: [50, 90], back: [50, 91] },
};
const SOAP_REGION_ABBR: Record<string, string> = {
  'Scalp': 'Sc', 'Face': 'Fa', 'Neck': 'Nk', 'Shoulders': 'Sh', 'Pectoral Muscles': 'Pec',
  'Back': 'Bk', 'Arms & Hands': 'Arm', 'Abdomen': 'Ab', 'Gluteal Region': 'Glt', 'Legs': 'Leg', 'Feet': 'Ft',
};

// Marker key for the body chart. Picking a marker makes the body figure a
// stamp: tap a region and it records that finding at a sensible starting
// severity, instead of "flag region, then type what you found". The finding
// text is the same free-text field as before, so nothing new has to be stored.
const BODY_MARKERS = [
  { key: 'knot',    label: 'Knot',          glyph: '★', color: '#c026d3', finding: 'Knotted',      severity: 6 },
  { key: 'tight',   label: 'Tight muscle',  glyph: '✕', color: '#2563eb', finding: 'Tight',        severity: 4 },
  { key: 'trigger', label: 'Trigger point', glyph: '◍', color: '#ca8a04', finding: 'Trigger pt',   severity: 5 },
  { key: 'pain1',   label: 'Pain — mild',   glyph: '●', color: '#fda4af', finding: 'Tender',       severity: 3 },
  { key: 'pain2',   label: 'Pain — moderate', glyph: '●', color: '#f43f5e', finding: 'Painful',    severity: 6 },
  { key: 'pain3',   label: 'Pain — severe', glyph: '●', color: '#be123c', finding: 'Severe pain',  severity: 9 },
] as const;
type BodyMarker = typeof BODY_MARKERS[number];

// Which marker a flagged region is showing — inferred from its findings text so
// an existing note (written before the key existed) still renders correctly.
function markerFor(a: AreaConcern): BodyMarker | null {
  const f = (a.findings || '').toLowerCase();
  for (const m of [...BODY_MARKERS].reverse()) if (f.includes(m.finding.toLowerCase())) return m;
  return null;
}

function BodyMapPicker({ areas, onChange }: { areas: AreaConcern[]; onChange: (a: AreaConcern[]) => void }) {
  const used = new Set(areas.map((a) => a.region));
  const [marker, setMarker] = useState<BodyMarker | null>(null);
  const [show, setShow] = useState<'both' | 'front' | 'back'>('both');
  // Undo stack of prior `areas` snapshots — mis-taps on a body figure are easy.
  const [history, setHistory] = useState<AreaConcern[][]>([]);
  const commit = (next: AreaConcern[]) => { setHistory((h) => [...h.slice(-19), areas]); onChange(next); };
  const undo = () => setHistory((h) => { if (!h.length) return h; onChange(h[h.length - 1]); return h.slice(0, -1); });

  const addRegion = (region: string) => { if (region && !used.has(region)) commit([...areas, { region, severity: DEFAULT_SEVERITY, findings: '', focus: false }]); };
  // With a marker armed, tapping stamps that finding (adding the region if new).
  // With no marker armed this is the original add/remove toggle.
  const toggleRegion = (region: string) => {
    if (marker) {
      const at = areas.findIndex((a) => a.region === region);
      if (at < 0) commit([...areas, { region, severity: marker.severity, findings: marker.finding, focus: false }]);
      else commit(areas.map((a, i) => i === at
        ? { ...a, severity: marker.severity, findings: (a.findings || '').toLowerCase().includes(marker.finding.toLowerCase()) ? a.findings : appendText(a.findings || '', marker.finding) }
        : a));
      return;
    }
    if (used.has(region)) commit(areas.filter((a) => a.region !== region));
    else commit([...areas, { region, severity: DEFAULT_SEVERITY, findings: '', focus: false }]);
  };
  const update = (i: number, patch: Partial<AreaConcern>) => onChange(areas.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const remove = (i: number) => commit(areas.filter((_, idx) => idx !== i));

  const countIn = (view: 'front' | 'back') =>
    areas.filter((a) => SOAP_REGION_POS[a.region]?.[view]).length;

  const figure = (view: 'front' | 'back', label: string) => (
    <figure class={'relative ' + (show === 'both' ? 'w-[46%] max-w-[200px]' : 'w-full max-w-[290px]')}>
      <img src={`/bodymap-${view}.png`} width={848} height={1264} alt={`${label} of the body`} class="w-full rounded-md border border-[var(--color-border)] bg-white" />
      {SOAP_REGIONS.filter((r) => SOAP_REGION_POS[r]?.[view]).map((r) => {
        const pos = SOAP_REGION_POS[r]![view]!;
        const area = areas.find((a) => a.region === r);
        const on = !!area;
        const m = area ? markerFor(area) : null;
        const dot = m ? m.color : 'var(--color-accent)';
        return (
          <button key={r} type="button" title={`${r}${on ? ` — ${area!.findings || 'flagged'} (sev ${area!.severity})` : marker ? ` — tap to mark ${marker.label}` : ''}`}
            aria-pressed={on} onClick={() => toggleRegion(r)}
            class="absolute flex items-center justify-center rounded-full border text-[10px] font-bold leading-none transition"
            style={`left:${pos[0]}%;top:${pos[1]}%;width:22px;height:22px;transform:translate(-50%,-50%);cursor:pointer;${on
              ? `background:${dot};color:#fff;border-color:${dot};box-shadow:0 0 0 3px color-mix(in srgb, ${dot} 32%, transparent)`
              : 'background:color-mix(in srgb,#000 45%,transparent);color:#fff;border-color:rgba(255,255,255,.6)'}`}>
            {on && m ? m.glyph : (SOAP_REGION_ABBR[r] || r.slice(0, 2))}
          </button>
        );
      })}
      <figcaption class="mt-1 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
        {label}{countIn(view) > 0 && <span class="ml-1 text-[var(--color-accent)]">{countIn(view)}</span>}
      </figcaption>
    </figure>
  );

  return (
    <div class="mt-4 rounded-lg border border-[var(--color-border)] p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
          Body chart — {marker ? <span style={`color:${marker.color}`}>marking “{marker.label}” · tap a region</span> : 'tap the body to flag a region'}
        </div>
        <select class={`${inputClass} w-auto py-1`} value="" onChange={(e) => { addRegion((e.currentTarget as HTMLSelectElement).value); (e.currentTarget as HTMLSelectElement).value = ''; }}>
          <option value="">+ add region…</option>
          {SOAP_REGIONS.filter((r) => !used.has(r)).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Marker key + view switch + undo */}
      <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Key</span>
        {BODY_MARKERS.map((m) => (
          <button key={m.key} type="button" onClick={() => setMarker(marker?.key === m.key ? null : m)} aria-pressed={marker?.key === m.key}
            class={'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none transition '
              + (marker?.key === m.key ? 'border-transparent text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}
            style={marker?.key === m.key ? `background:color-mix(in srgb, ${m.color} 20%, transparent)` : ''}>
            <span style={`color:${m.color}`}>{m.glyph}</span> {m.label}
          </button>
        ))}
        <div class="ml-auto flex items-center gap-1.5">
          {(['both', 'front', 'back'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setShow(v)} aria-pressed={show === v}
              class={'rounded px-1.5 py-0.5 text-[11px] capitalize transition '
                + (show === v ? 'bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>{v}</button>
          ))}
          <button type="button" onClick={undo} disabled={history.length === 0} title="Undo the last body-chart change"
            class="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">
            ↺ Undo
          </button>
        </div>
      </div>

      <div class="mb-3 flex justify-center gap-4">
        {show !== 'back' && figure('front', 'Front')}
        {show !== 'front' && figure('back', 'Back')}
      </div>
      {areas.length === 0 && <div class="py-2 text-center text-[12px] text-[var(--color-text-faint)]">No regions flagged. Tap a spot on the body (or use the dropdown) to record severity + findings.</div>}
      <div class="space-y-2">
        {areas.map((a, i) => (
          <div key={a.region} class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="min-w-[68px] text-[13px] font-semibold text-[var(--color-text)]">{a.region}</span>
              <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">sev</span>
              <div class="flex flex-wrap gap-0.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} type="button" title={`severity ${n}`} onClick={() => update(i, { severity: n })}
                    class={`h-5 w-5 rounded text-[10px] font-bold leading-none transition ${a.severity === n ? 'text-white' : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                    style={a.severity === n ? `background:hsl(${Math.round(120 - (n - 1) * 12)} 68% 42%)` : ''}>
                    {n}
                  </button>
                ))}
              </div>
              <label class="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)]">
                <input type="checkbox" checked={!!a.focus} onChange={(e) => update(i, { focus: (e.currentTarget as HTMLInputElement).checked })} /> focus next
              </label>
              <button type="button" title="Remove region" class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)]" onClick={() => remove(i)}><X size={13} /></button>
            </div>
            <div class="mt-1.5 flex flex-wrap items-center gap-1">
              {[...(REGION_FINDING_CHIPS[a.region] || []), ...FINDING_CHIPS].map((f) => (
                <Chip key={f} label={`+ ${f}`} onClick={() => update(i, { findings: appendText(a.findings || '', f) })} />
              ))}
              <MicButton onText={(t) => update(i, { findings: appendText(a.findings || '', t) })} />
            </div>
            <input class={`${inputClass} mt-1.5 py-1`} placeholder="findings — tap chips above, dictate, or type" value={a.findings || ''} onInput={(e) => update(i, { findings: (e.currentTarget as HTMLInputElement).value })} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────── Client Profile tab ──
// One place per client instead of hunting the same person across Accounts →
// Intake Forms → SOAP Notes. Picks a client, then shows a clinical timeline
// (intakes + SOAP notes + bookings merged, newest first), their editable
// details, and their submitted forms — with the at-a-glance vitals on top.

type TimelineKind = 'soap' | 'intake' | 'appt';
interface TimelineEvent {
  key: string;
  kind: TimelineKind;
  /** YYYY-MM-DD used for sorting + the rail label. */
  date: string;
  title: string;
  subtitle?: string;
  soap?: SoapNote;
  intake?: IntakeRow;
  appt?: Appointment;
}

const KIND_TONE: Record<TimelineKind, { label: string; color: string }> = {
  intake: { label: 'Intake', color: 'var(--color-warn)' },
  soap: { label: 'SOAP', color: 'var(--color-accent)' },
  appt: { label: 'Booking', color: 'var(--color-text-muted)' },
};

function ProfileStat({ label, value, tone, hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] px-3 py-2.5">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      <div class="mt-0.5 truncate text-[15px] font-semibold" style={tone ? `color:${tone}` : 'color:var(--color-text)'} title={hint || String(value)}>{value}</div>
    </div>
  );
}

function ClientProfileTab({ overview, canEdit }: { overview: ReturnType<typeof useFetch<Overview>>; canEdit: boolean }) {
  const clients = overview.data?.clients ?? [];
  const [clientId, setClientId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const selected = clients.find((c) => c.id === clientId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? clients.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)) : clients;
    // Most recently seen first — the people you're actually working with float up.
    return [...rows].sort((a, b) => (b.lastVisitMs ?? 0) - (a.lastVisitMs ?? 0));
  }, [clients, query]);

  if (selected) {
    return <ClientProfile key={selected.id} client={selected} canEdit={canEdit} onBack={() => setClientId(null)} onChanged={() => overview.refresh()} />;
  }

  return (
    <section>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <input class={`${inputClass} max-w-[320px] py-1.5`} placeholder="Search name / email / phone" value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        <span class="text-[12px] text-[var(--color-text-faint)]">{filtered.length} client{filtered.length === 1 ? '' : 's'}</span>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => (
          <button key={c.id} type="button" onClick={() => setClientId(c.id)}
            class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-elevated)]">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)]">
              <UserRound size={16} class="text-[var(--color-accent)]" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] font-semibold text-[var(--color-text)]">{c.name || c.email}</span>
              <span class="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{c.email}</span>
              <span class="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">
                last seen {agoFromMs(c.lastVisitMs)} · {c.appointmentCount} session{c.appointmentCount === 1 ? '' : 's'}
                {c.upcomingAppointmentCount ? ` · ${c.upcomingAppointmentCount} upcoming` : ''}
              </span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div class="col-span-full rounded-lg border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-faint)]">No matching clients.</div>
        )}
      </div>
    </section>
  );
}

function ClientProfile({ client, canEdit, onBack, onChanged }: {
  client: MassageClient; canEdit: boolean; onBack: () => void; onChanged: () => void;
}) {
  const soap = useFetch<SoapClientResp>(`/api/massage-admin/soap?client=${encodeURIComponent(client.id)}`, 0);
  const appts = useFetch<{ appointments: Appointment[] }>(`/api/massage-admin/clients/${encodeURIComponent(client.id)}/appointments`, 0);
  const intakes = useFetch<{ intakes: IntakeRow[] }>('/api/massage-admin/intakes', 0);

  const [pane, setPane] = useState<'timeline' | 'general' | 'forms'>('timeline');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // null = viewing; otherwise the SOAP editor is open (new note, or editing one).
  const [editing, setEditing] = useState<null | { note: SoapNote | null }>(null);

  const notes = soap.data?.notes ?? [];
  const cf = soap.data?.carry_forward;
  const appointments = appts.data?.appointments ?? [];
  const myIntakes = useMemo(
    () => (intakes.data?.intakes ?? []).filter((i) => i.user_id === client.id || (client.email && i.client_email === client.email)),
    [intakes.data, client.id, client.email],
  );

  // Merge everything clinical into one chronological rail.
  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = [];
    for (const n of notes) {
      out.push({
        key: `soap:${n.id}`, kind: 'soap',
        date: n.session_date || (n.created_at || '').slice(0, 10),
        title: 'SOAP note',
        subtitle: [
          n.pain_before != null || n.pain_after != null ? `pain ${n.pain_before ?? '—'} → ${n.pain_after ?? '—'}` : '',
          n.areas_concern?.map((a) => a.region).join(', ') || '',
        ].filter(Boolean).join(' · '),
        soap: n,
      });
    }
    for (const i of myIntakes) {
      out.push({
        key: `intake:${i.id}`, kind: 'intake',
        date: (i.submitted_at || '').slice(0, 10),
        title: 'Patient intake',
        subtitle: [i.service_name || '', i.reviewed_at ? 'reviewed' : 'not reviewed'].filter(Boolean).join(' · '),
        intake: i,
      });
    }
    for (const a of appointments) {
      out.push({
        key: `appt:${a.id}`, kind: 'appt',
        date: a.appt_date,
        title: a.service_name || 'Session',
        subtitle: `${a.appt_time} · ${a.status}`,
        appt: a,
      });
    }
    return out.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  }, [notes, myIntakes, appointments]);

  useEffect(() => { if (!selectedKey && events[0]) setSelectedKey(events[0].key); }, [events, selectedKey]);
  const selectedEvent = events.find((e) => e.key === selectedKey) ?? null;

  const flags = Object.values(cf?.flags ?? {});
  const focusNext = cf?.next_focus ?? [];
  const lastNote = notes[0];

  const refreshClinical = () => { soap.refresh(); setEditing(null); };

  return (
    <section class="space-y-4">
      {/* Header */}
      <div class="flex flex-wrap items-start gap-3">
        <button type="button" onClick={onBack} title="Back to client list"
          class="mt-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]">←</button>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-[19px] font-semibold text-[var(--color-text)]">{client.name || client.email}</h2>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--color-text-muted)]">
            <span class="inline-flex items-center gap-1.5"><Mail size={12} /> {client.email}</span>
            {client.phone && <span class="inline-flex items-center gap-1.5">☎ {client.phone}</span>}
            {client.accountStatus !== 'active' && (
              <span class="rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-warn)]">{client.accountStatus}</span>
            )}
          </div>
        </div>
        <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit}
          onClick={() => { setPane('timeline'); setEditing({ note: null }); }}>
          <Plus size={13} /> New session note
        </button>
      </div>

      {/* Vitals */}
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <ProfileStat label="Last seen" value={agoFromMs(client.lastVisitMs)} />
        <ProfileStat label="Sessions" value={client.appointmentCount} />
        <ProfileStat label="Notes on file" value={notes.length} />
        <ProfileStat label="Upcoming" value={client.upcomingAppointmentCount}
          tone={client.upcomingAppointmentCount ? 'var(--color-accent)' : undefined} />
        <ProfileStat label="Red flags" value={flags.length ? `${flags.length} flagged` : 'Clear'}
          tone={flags.length ? 'var(--color-status-failed)' : 'var(--color-status-done)'}
          hint={flags.map((f) => `${f.label}: ${f.value}`).join(' · ')} />
        <ProfileStat label="Focus next" value={focusNext.length ? focusNext.map((f) => f.region).join(', ') : '—'}
          tone={focusNext.length ? 'var(--color-accent)' : undefined}
          hint={focusNext.map((f) => f.region + (f.note ? ` (${f.note})` : '')).join(' · ')} />
      </div>

      {flags.length > 0 && (
        <div class="rounded-lg border border-[var(--color-warn)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
          <span class="font-semibold">⚠ Intake safety flags:</span> {flags.map((f) => `${f.label}: ${f.value}`).join(' · ')}
        </div>
      )}

      {/* Panes */}
      <div class="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]">
        {([['timeline', 'Clinical Timeline'], ['general', 'General information'], ['forms', 'Forms']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setPane(k)} aria-pressed={pane === k}
            class={'-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium transition-colors '
              + (pane === k
                ? 'border-[var(--color-accent)] text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
            {label}
            {k === 'forms' && myIntakes.length > 0 && <span class="ml-1.5 text-[11px] text-[var(--color-text-faint)]">{myIntakes.length}</span>}
          </button>
        ))}
      </div>

      {pane === 'general' && <AccountDetail client={client} canEdit={canEdit} onChanged={onChanged} />}

      {pane === 'forms' && (
        <div class="space-y-3">
          {myIntakes.length === 0
            ? <div class="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-[13px] text-[var(--color-text-faint)]">No intake forms submitted by this client yet.</div>
            : myIntakes.map((i) => <IntakeViewer key={i.id} id={i.id} canEdit={canEdit} onReviewed={() => intakes.refresh()} />)}
        </div>
      )}

      {pane === 'timeline' && (editing
        ? (
          <SoapForm
            client={client}
            appointments={appointments}
            existing={editing.note}
            seed={null}
            history={notes}
            carryForward={editing.note ? null : (cf ?? null)}
            canEdit={canEdit}
            onCancel={() => setEditing(null)}
            onSaved={refreshClinical}
          />
        )
        : (
          <div class="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            {/* Event rail */}
            <aside class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
              <div class="border-b border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)]">
                {events.length} entr{events.length === 1 ? 'y' : 'ies'}
              </div>
              <div class="max-h-[620px] overflow-y-auto">
                {events.map((e) => {
                  const tone = KIND_TONE[e.kind];
                  const on = e.key === selectedKey;
                  return (
                    <button key={e.key} type="button" onClick={() => setSelectedKey(e.key)}
                      class={'flex w-full items-start gap-2.5 border-b border-[var(--color-border)] px-3 py-2.5 text-left transition-colors last:border-b-0 '
                        + (on ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'hover:bg-[var(--color-elevated)]')}>
                      <span class="mt-1 h-2 w-2 shrink-0 rounded-full" style={`background:${tone.color}`} />
                      <span class="min-w-0 flex-1">
                        <span class="flex items-center justify-between gap-2">
                          <span class="truncate text-[13px] font-semibold text-[var(--color-text)]">{e.date || '—'}</span>
                          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={`color:${tone.color};background:color-mix(in srgb, ${tone.color} 14%, transparent)`}>{tone.label}</span>
                        </span>
                        <span class="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">{e.title}</span>
                        {e.subtitle && <span class="mt-0.5 block truncate text-[11px] text-[var(--color-text-faint)]">{e.subtitle}</span>}
                      </span>
                    </button>
                  );
                })}
                {events.length === 0 && (
                  <div class="px-3 py-8 text-center text-[13px] text-[var(--color-text-faint)]">
                    Nothing on file yet. Start with a session note.
                  </div>
                )}
              </div>
            </aside>

            {/* Detail pane */}
            <main class="space-y-4">
              {selectedEvent?.kind === 'intake' && selectedEvent.intake && (
                <IntakeViewer id={selectedEvent.intake.id} canEdit={canEdit} onReviewed={() => intakes.refresh()} />
              )}
              {selectedEvent?.kind === 'soap' && selectedEvent.soap && (
                <SoapNoteDetail note={selectedEvent.soap} canEdit={canEdit} onEdit={() => setEditing({ note: selectedEvent.soap! })} />
              )}
              {selectedEvent?.kind === 'appt' && selectedEvent.appt && (
                <AppointmentDetail appt={selectedEvent.appt} note={notes.find((n) => n.appointment_id === selectedEvent.appt!.id) ?? null}
                  canEdit={canEdit} onWriteNote={() => setEditing({ note: null })} />
              )}
              {!selectedEvent && (
                <div class="rounded-lg border border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-faint)]">
                  Select an entry on the left.
                </div>
              )}
              {soap.data && notes.length > 0 && <TissueTrend trend={soap.data.trend} />}
              {lastNote?.home_care && (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4 text-[13px]">
                  <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Latest home care</div>
                  <div class="text-[var(--color-text-muted)]">{lastNote.home_care}</div>
                </div>
              )}
            </main>
          </div>
        ))}
    </section>
  );
}

// Read-only view of one SOAP note — the clinical record as written, with an
// Edit jump into the same form the SOAP Notes tab uses.
function SoapNoteDetail({ note, canEdit, onEdit }: { note: SoapNote; canEdit: boolean; onEdit: () => void }) {
  const row = (label: string, value: string | null | undefined) => value
    ? (
      <div>
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
        <div class="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text)]">{value}</div>
      </div>
    ) : null;

  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-[15px] font-semibold text-[var(--color-text)]">Session {note.session_date || (note.created_at || '').slice(0, 10)}</h3>
          <div class="mt-1 flex flex-wrap gap-x-3 text-[12px] text-[var(--color-text-faint)]">
            {(note.pain_before != null || note.pain_after != null) && (
              <span>pain {note.pain_before ?? '—'} → <span class="text-[var(--color-status-done)]">{note.pain_after ?? '—'}</span></span>
            )}
            {note.pressure && <span>· {note.pressure}</span>}
            {note.position && <span>· {note.position}</span>}
            {note.duration_min ? <span>· {note.duration_min} min</span> : null}
            {note.author && <span>· {note.author}</span>}
          </div>
        </div>
        <button type="button" class={btnGhost} disabled={!canEdit} onClick={onEdit}>Edit note</button>
      </div>

      {note.techniques?.length > 0 && (
        <div class="mb-3 flex flex-wrap gap-1">
          {note.techniques.map((t) => (
            <span key={t} class="rounded bg-[var(--color-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">{t}</span>
          ))}
        </div>
      )}

      {note.areas_concern?.length > 0 && (
        <div class="mb-3 space-y-1">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Areas of concern</div>
          {note.areas_concern.map((a, i) => (
            <div key={i} class="flex flex-wrap items-baseline gap-2 text-[13px]">
              <span class="font-semibold text-[var(--color-text)]">{a.region}</span>
              <span class="rounded px-1.5 text-[11px] font-bold text-white"
                style={`background:hsl(${Math.round(120 - ((a.severity || 1) - 1) * 12)} 68% 42%)`}>{a.severity}</span>
              {a.focus && <span class="text-[11px] text-[var(--color-accent)]">★ focus next</span>}
              {a.findings && <span class="text-[12px] text-[var(--color-text-muted)]">{a.findings}</span>}
            </div>
          ))}
        </div>
      )}

      <div class="grid gap-3 md:grid-cols-2">
        {row('Subjective', note.subjective)}
        {row('Objective', note.objective)}
        {row('Assessment', note.assessment)}
        {row('Plan', note.plan)}
        {row('Home care', note.home_care)}
        {row('Referrals', note.referrals)}
        {row('Adverse reactions', note.adverse_reactions)}
      </div>
    </section>
  );
}

// A booking on the timeline — plus the "no note written" nudge that used to
// require cross-checking the SOAP tab by hand.
function AppointmentDetail({ appt, note, canEdit, onWriteNote }: {
  appt: Appointment; note: SoapNote | null; canEdit: boolean; onWriteNote: () => void;
}) {
  const past = appt.start_ms ? appt.start_ms < Date.now() : false;
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-[15px] font-semibold text-[var(--color-text)]">{appt.service_name || 'Session'}</h3>
          <div class="mt-1 flex flex-wrap gap-x-3 text-[12px] text-[var(--color-text-faint)]">
            <span>{fmtDay(appt.appt_date)} · {appt.appt_time}</span>
            <span>· {appt.status}</span>
            {appt.enhancement_applied && <span class="text-[var(--color-accent)]">· 🎁 {appt.enhancement_applied}</span>}
          </div>
        </div>
        {!note && past && (
          <button type="button" class={btnAccent} style="background:var(--color-accent)" disabled={!canEdit} onClick={onWriteNote}>
            <Plus size={13} /> Write the note
          </button>
        )}
      </div>
      <div class="mt-3 text-[13px]">
        {note
          ? <span class="text-[var(--color-status-done)]">✓ SOAP note on file for this session.</span>
          : past
            ? <span class="text-[var(--color-warn)]">No SOAP note written for this past session.</span>
            : <span class="text-[var(--color-text-muted)]">Upcoming — the note can be written after the session.</span>}
      </div>
    </section>
  );
}
