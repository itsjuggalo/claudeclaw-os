// Intake form builder — edits the QUESTIONS clients are asked on the massage
// site, instead of hand-editing config/intake.json on the box.
//
// Shape follows Grafo's builder: a canvas of sections/questions on the left, an
// inspector for the selected question on the right, and a client-eye preview.
// Reorder is drag-and-drop on a desktop and ↑/↓ buttons on a phone — the phone
// is where Mike actually uses this, and HTML5 drag doesn't exist on touch.
//
// Two things this deliberately will NOT let you do, because the intake form is a
// legal record (FL §480.043(14)(f), 64B7-26.003): delete a protected section or
// field, or make a protected field optional. The server enforces both; the UI
// just marks them 🔒 so you don't discover it at save time.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ChevronDown, ChevronUp, Copy, Eye, FilePlus2, GripVertical, History,
  Lock, Plus, RotateCcw, Save, Trash2, TriangleAlert,
} from 'lucide-preact';
import { useFetch, invalidateFetchCache } from '@/lib/useFetch';
import { apiPost, apiPut } from '@/lib/api';

export interface BuilderField {
  name: string;
  type: string;
  label?: string;
  text?: string;
  note?: string;
  required?: boolean;
  options?: string[];
  layout?: string;
  detail?: boolean;
  detailPlaceholder?: string;
  [k: string]: unknown;
}
export interface BuilderSection { id: string; title: string; intro?: string; lawNote?: string; fields: BuilderField[] }
export interface BuilderSchema { title?: string; intro?: string; sections: BuilderSection[]; [k: string]: unknown }
interface FieldType { id: string; label: string; options?: boolean }
interface BuilderState {
  ok: boolean;
  schema: BuilderSchema;
  fieldTypes: FieldType[];
  protectedFields: string[];
  protectedSections: string[];
  backups: { name: string; savedAt: string; bytes: number }[];
}

const input = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[14px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60';
const ghost = 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-[14px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)] disabled:opacity-40';
const accent = 'inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// Types whose "answer" is a fixed list the therapist writes.
const OPTION_TYPES = new Set(['select', 'radio', 'checkgroup']);
// Types that carry body text instead of a label.
const TEXT_TYPES = new Set(['note', 'acknowledge']);

export function FormBuilder({ canEdit }: { canEdit: boolean }) {
  const state = useFetch<BuilderState>('/api/massage-admin/intake-schema', 0);
  const [draft, setDraft] = useState<BuilderSchema | null>(null);
  const [sel, setSel] = useState<{ s: number; f: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [preview, setPreview] = useState(false);
  const dragRef = useRef<{ s: number; f: number } | null>(null);

  // Load the server copy into the draft once, and again whenever a save/restore
  // replaces it. Never clobber in-progress edits on a background refresh.
  const serverJson = state.data ? JSON.stringify(state.data.schema) : '';
  useEffect(() => { if (state.data) setDraft(clone(state.data.schema)); }, [serverJson]);

  const types = state.data?.fieldTypes ?? [];
  const lockedFields = useMemo(() => new Set(state.data?.protectedFields ?? []), [state.data?.protectedFields]);
  const lockedSections = useMemo(() => new Set(state.data?.protectedSections ?? []), [state.data?.protectedSections]);
  const dirty = !!draft && !!state.data && JSON.stringify(draft) !== serverJson;

  // Debounced dry-run validate so a mistake surfaces as you type, not at save.
  useEffect(() => {
    if (!draft || !dirty) { setErr(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiPost<{ ok: boolean; error?: string }>('/api/massage-admin/intake-schema/validate', { schema: draft });
        setErr(r.ok ? null : (r.error || 'invalid'));
      } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
      finally { setChecking(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [JSON.stringify(draft)]);

  function edit(fn: (d: BuilderSchema) => void) {
    setDraft((cur) => { if (!cur) return cur; const next = clone(cur); fn(next); return next; });
    setSaved(null);
  }

  function addSection() {
    edit((d) => {
      let n = 1; while (d.sections.some((s) => s.id === `section_${n}`)) n++;
      d.sections.push({ id: `section_${n}`, title: `New section ${n}`, fields: [] });
    });
  }
  function addField(si: number) {
    edit((d) => {
      const taken = new Set(d.sections.flatMap((s) => s.fields.map((f) => f.name)));
      let n = 1; while (taken.has(`question_${n}`)) n++;
      d.sections[si].fields.push({ name: `question_${n}`, type: 'text', label: 'New question' });
    });
    setSel({ s: si, f: (draft?.sections[si].fields.length ?? 0) });
  }
  function moveField(si: number, fi: number, delta: number) {
    edit((d) => {
      const fs = d.sections[si].fields;
      const to = fi + delta;
      if (to < 0 || to >= fs.length) return;
      [fs[fi], fs[to]] = [fs[to], fs[fi]];
    });
    setSel({ s: si, f: Math.max(0, Math.min((draft?.sections[si].fields.length ?? 1) - 1, fi + delta)) });
  }
  function dropOn(si: number, fi: number) {
    const from = dragRef.current;
    dragRef.current = null;
    if (!from || (from.s === si && from.f === fi)) return;
    edit((d) => {
      const [moved] = d.sections[from.s].fields.splice(from.f, 1);
      // Removing from an earlier slot in the SAME section shifts the target left.
      const target = from.s === si && from.f < fi ? fi - 1 : fi;
      d.sections[si].fields.splice(target, 0, moved);
    });
    setSel({ s: si, f: fi });
  }
  function duplicateField(si: number, fi: number) {
    edit((d) => {
      const src = d.sections[si].fields[fi];
      const taken = new Set(d.sections.flatMap((s) => s.fields.map((f) => f.name)));
      let n = 2; while (taken.has(`${src.name}_${n}`)) n++;
      d.sections[si].fields.splice(fi + 1, 0, { ...clone(src), name: `${src.name}_${n}`, required: false });
    });
  }
  function deleteField(si: number, fi: number) {
    edit((d) => { d.sections[si].fields.splice(fi, 1); });
    setSel(null);
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiPut<{ ok: boolean; error?: string; backup?: string; fields?: number }>('/api/massage-admin/intake-schema', { schema: draft });
      if (!r.ok) { setErr(r.error || 'save failed'); return; }
      setSaved(`Saved — live now on the booking site. Previous version kept as ${r.backup || 'a backup'}.`);
      invalidateFetchCache('/api/massage-admin/intake-schema');
      state.refresh();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function restore(name: string) {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>('/api/massage-admin/intake-schema/restore', { name });
      if (!r.ok) { setErr(r.error || 'restore failed'); return; }
      setSaved(`Restored ${name}.`);
      setShowBackups(false);
      invalidateFetchCache('/api/massage-admin/intake-schema');
      state.refresh();
    } catch (e: any) { setErr(e?.body?.error || e?.message || String(e)); }
    finally { setBusy(false); }
  }

  if (state.error) return <div class="text-[15px] text-[var(--color-status-failed)]">Could not load the intake form: {String(state.error)}</div>;
  if (!draft || !state.data) return <div class="text-[15px] text-[var(--color-text-faint)]">Loading the intake form…</div>;

  const totalFields = draft.sections.reduce((n, s) => n + s.fields.length, 0);
  const selField = sel ? draft.sections[sel.s]?.fields[sel.f] : null;

  return (
    <div class="space-y-4">
      <section class="rounded-lg border border-[var(--color-border)] px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-[16px] font-semibold text-[var(--color-text)]">Intake form builder</div>
            <div class="text-[14px] text-[var(--color-text-muted)]">
              {draft.sections.length} sections · {totalFields} questions ·{' '}
              {dirty ? <span class="text-[var(--color-warn)]">unsaved changes</span> : 'in sync with the live form'}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class={ghost} onClick={() => setPreview((v) => !v)}><Eye size={15} /> {preview ? 'Hide preview' : 'Preview'}</button>
            <button type="button" class={ghost} onClick={() => setShowBackups((v) => !v)}><History size={15} /> Versions {state.data.backups.length > 0 && `(${state.data.backups.length})`}</button>
            <button type="button" class={ghost} disabled={!dirty} onClick={() => { setDraft(clone(state.data!.schema)); setSel(null); setSaved(null); }}><RotateCcw size={15} /> Discard</button>
            <button type="button" class={accent} style="background:var(--color-accent)" disabled={!canEdit || busy || !dirty || !!err} onClick={save}>
              <Save size={15} /> {busy ? 'Saving…' : 'Save form'}
            </button>
          </div>
        </div>
        <div class="mt-2 text-[14px] text-[var(--color-text-faint)]">
          Saving takes effect immediately for anyone opening their intake link — there is no deploy step.
          Questions marked <Lock size={12} class="inline" /> are required by Florida law and can be re-worded but not removed.
        </div>
        {checking && <div class="mt-2 text-[14px] text-[var(--color-text-faint)]">Checking…</div>}
        {err && (
          <div class="mt-2 flex items-start gap-1.5 rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[14px] text-[var(--color-status-failed)]">
            <TriangleAlert size={15} class="mt-0.5 shrink-0" /> <span>{err}</span>
          </div>
        )}
        {saved && <div class="mt-2 rounded-md border border-[var(--color-accent)] px-3 py-2 text-[14px] text-[var(--color-accent)]">{saved}</div>}
        {showBackups && (
          <div class="mt-3 rounded-md border border-[var(--color-border)]">
            {state.data.backups.length === 0
              ? <div class="px-3 py-2 text-[14px] text-[var(--color-text-faint)]">No previous versions yet — one is kept every time you save.</div>
              : state.data.backups.map((b) => (
                <div key={b.name} class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0">
                  <div class="text-[14px] text-[var(--color-text-muted)]">{new Date(b.savedAt).toLocaleString()}<span class="ml-2 text-[var(--color-text-faint)]">{b.name}</span></div>
                  <button type="button" class={ghost} disabled={!canEdit || busy} onClick={() => void restore(b.name)}>Restore this version</button>
                </div>
              ))}
          </div>
        )}
      </section>

      {preview && <ClientPreview schema={draft} />}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
        {/* ── canvas ── */}
        <div class="space-y-3">
          {draft.sections.map((sec, si) => (
            <section key={sec.id + si} class="rounded-lg border border-[var(--color-border)]">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <input
                  class="min-w-[160px] flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold text-[var(--color-text)] outline-none hover:border-[var(--color-border)] focus:border-[var(--color-accent)]"
                  value={sec.title} disabled={!canEdit}
                  onInput={(e) => edit((d) => { d.sections[si].title = (e.currentTarget as HTMLInputElement).value; })}
                />
                <div class="flex items-center gap-1.5">
                  {lockedSections.has(sec.id) && <span title="Required by Florida law" class="text-[var(--color-text-faint)]"><Lock size={14} /></span>}
                  <span class="text-[13px] text-[var(--color-text-faint)]">{sec.fields.length}</span>
                  <button type="button" class={ghost} disabled={!canEdit} onClick={() => addField(si)}><Plus size={14} /> Add question</button>
                  <button type="button" class={ghost} title={lockedSections.has(sec.id) ? 'Delete section — locked, required by Florida law' : 'Delete section'}
                    disabled={!canEdit || lockedSections.has(sec.id)}
                    onClick={() => { edit((d) => { d.sections.splice(si, 1); }); setSel(null); }}><Trash2 size={14} /></button>
                </div>
              </div>
              {sec.fields.length === 0 && <div class="px-3 py-3 text-[14px] text-[var(--color-text-faint)]">No questions yet.</div>}
              {sec.fields.map((f, fi) => {
                const locked = lockedFields.has(f.name);
                const active = sel?.s === si && sel?.f === fi;
                return (
                  <div key={f.name + fi}
                    draggable={canEdit}
                    onDragStart={() => { dragRef.current = { s: si, f: fi }; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(si, fi)}
                    onClick={() => setSel({ s: si, f: fi })}
                    class={`flex cursor-pointer items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 ${active ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]' : 'hover:bg-[var(--color-elevated)]'}`}>
                    <GripVertical size={14} class="shrink-0 text-[var(--color-text-faint)]" />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[15px] text-[var(--color-text)]">
                        {f.label || f.text || f.name}
                        {f.required && <span class="ml-1 text-[var(--color-status-failed)]">*</span>}
                        {locked && <Lock size={12} class="ml-1 inline text-[var(--color-text-faint)]" />}
                      </div>
                      <div class="truncate text-[13px] text-[var(--color-text-faint)]">
                        {types.find((t) => t.id === f.type)?.label || f.type} · {f.name}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <button type="button" class={ghost} title="Move up" disabled={!canEdit || fi === 0} onClick={(e) => { e.stopPropagation(); moveField(si, fi, -1); }}><ChevronUp size={14} /></button>
                      <button type="button" class={ghost} title="Move down" disabled={!canEdit || fi === sec.fields.length - 1} onClick={(e) => { e.stopPropagation(); moveField(si, fi, 1); }}><ChevronDown size={14} /></button>
                      <button type="button" class={ghost} title="Duplicate" disabled={!canEdit} onClick={(e) => { e.stopPropagation(); duplicateField(si, fi); }}><Copy size={14} /></button>
                      <button type="button" class={ghost} title={locked ? 'Delete question — locked, required by Florida law' : 'Delete question'} disabled={!canEdit || locked}
                        onClick={(e) => { e.stopPropagation(); deleteField(si, fi); }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          <button type="button" class={ghost} disabled={!canEdit} onClick={addSection}><FilePlus2 size={15} /> Add a section</button>
        </div>

        {/* ── inspector ── */}
        <div class="lg:sticky lg:top-2 lg:self-start">
          {!selField
            ? <div class="rounded-lg border border-[var(--color-border)] px-4 py-6 text-[14px] text-[var(--color-text-faint)]">Pick a question to edit it.</div>
            : <Inspector
                field={selField}
                types={types}
                locked={lockedFields.has(selField.name)}
                canEdit={canEdit}
                onChange={(patch) => edit((d) => { Object.assign(d.sections[sel!.s].fields[sel!.f], patch); })}
              />}
        </div>
      </div>
    </div>
  );
}

function Inspector({ field, types, locked, canEdit, onChange }: {
  field: BuilderField; types: FieldType[]; locked: boolean; canEdit: boolean;
  onChange: (patch: Partial<BuilderField>) => void;
}) {
  const usesText = TEXT_TYPES.has(field.type);
  const usesOptions = OPTION_TYPES.has(field.type);
  return (
    <div class="space-y-3 rounded-lg border border-[var(--color-accent)] px-4 py-3">
      <div class="text-[15px] font-semibold text-[var(--color-text)]">Question settings</div>
      {locked && (
        <div class="flex items-start gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-2 text-[13px] text-[var(--color-text-muted)]">
          <Lock size={13} class="mt-0.5 shrink-0" />
          <span>Required by Florida law. You can re-word it, but its name, type and required flag are fixed.</span>
        </div>
      )}
      <Row label={usesText ? 'Text shown to the client' : 'Question'}>
        <textarea class={`${input} min-h-[54px] resize-y`} disabled={!canEdit}
          value={usesText ? (field.text || '') : (field.label || '')}
          onInput={(e) => onChange(usesText ? { text: (e.currentTarget as HTMLTextAreaElement).value } : { label: (e.currentTarget as HTMLTextAreaElement).value })} />
      </Row>
      <Row label="Answer type">
        <select class={input} value={field.type} disabled={!canEdit || locked}
          onChange={(e) => onChange({ type: (e.currentTarget as HTMLSelectElement).value })}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Row>
      <Row label="Saved as" hint="The key this answer is stored under. Changing it orphans past answers — rename only for a brand-new question.">
        <input class={input} value={field.name} disabled={!canEdit || locked}
          onInput={(e) => onChange({ name: slug((e.currentTarget as HTMLInputElement).value) })} />
      </Row>
      {usesOptions && (
        <Row label="Choices" hint="One per line.">
          <textarea class={`${input} min-h-[92px] resize-y`} disabled={!canEdit}
            value={(field.options || []).join('\n')}
            onInput={(e) => onChange({ options: (e.currentTarget as HTMLTextAreaElement).value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
        </Row>
      )}
      <Row label="Helper note" hint="Small grey text under the question.">
        <input class={input} value={field.note || ''} disabled={!canEdit}
          onInput={(e) => onChange({ note: (e.currentTarget as HTMLInputElement).value || undefined })} />
      </Row>
      {field.type === 'yesno' && (
        <label class="flex items-center gap-2 text-[14px] text-[var(--color-text-muted)]">
          <input type="checkbox" checked={!!field.detail} disabled={!canEdit}
            onChange={(e) => onChange({ detail: (e.currentTarget as HTMLInputElement).checked })} />
          Ask for details when they answer Yes
        </label>
      )}
      <label class="flex items-center gap-2 text-[14px] text-[var(--color-text-muted)]">
        <input type="checkbox" checked={!!field.required} disabled={!canEdit || locked}
          onChange={(e) => onChange({ required: (e.currentTarget as HTMLInputElement).checked })} />
        Required — they can't submit without it
      </label>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: preact.ComponentChildren }) {
  return (
    <label class="block">
      <div class="mb-1 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      {children}
      {hint && <div class="mt-1 text-[13px] text-[var(--color-text-faint)]">{hint}</div>}
    </label>
  );
}

// Client-eye read of the DRAFT (including unsaved edits) — the real form lives on
// the massage site, so this is a faithful outline rather than a pixel mirror: it
// answers "did I word this right and is anything missing", not "how does it look".
function ClientPreview({ schema }: { schema: BuilderSchema }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] px-4 py-3">
      <div class="mb-2 text-[15px] font-semibold text-[var(--color-text)]">What the client sees</div>
      <div class="space-y-4">
        {schema.sections.map((sec) => (
          <div key={sec.id}>
            <div class="text-[15px] font-semibold text-[var(--color-accent)]">{sec.title}</div>
            {sec.intro && <div class="text-[14px] text-[var(--color-text-muted)]">{sec.intro}</div>}
            <ol class="mt-1 space-y-1">
              {sec.fields.map((f) => (
                <li key={f.name} class="text-[14px] text-[var(--color-text-muted)]">
                  {f.type === 'note'
                    ? <span class="italic text-[var(--color-text-faint)]">{f.text}</span>
                    : <>
                        <span class="text-[var(--color-text)]">{f.label || f.text || f.name}</span>
                        {f.required && <span class="text-[var(--color-status-failed)]">*</span>}
                        {OPTION_TYPES.has(f.type) && <span class="text-[var(--color-text-faint)]"> — {(f.options || []).join(' · ')}</span>}
                        {f.type === 'yesno' && <span class="text-[var(--color-text-faint)]"> — Yes · No</span>}
                      </>}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
