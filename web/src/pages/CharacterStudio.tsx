// Character Studio — train, validate, and publish reusable character LoRAs that
// hold one identity across every gen (the DaForgeLayer "trained actor" method on
// this box's local SDXL stack). Training itself is a heavy GPU step run from the
// CLI; this page manages the roster, shows the exact launch command, publishes a
// trained LoRA into ComfyUI (a C:-safe symlink), and runs the auto-QA gate on gens.
// Data: GET /api/characters, GET /api/characters/:name, POST .../config|publish,
//       POST /api/qa/review  (see src/character.ts, src/qa.ts).
import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiGet, apiPost } from '@/lib/api';
import {
  Drama, Sparkles, Copy, Play, CheckCircle2, AlertTriangle, ShieldCheck,
  Upload, Clapperboard, Image as ImageIcon, RefreshCw,
} from 'lucide-preact';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

type CharStatus = 'new' | 'configured' | 'trained' | 'validated' | 'published';
interface Character {
  name: string; trigger: string; klass?: string; status: CharStatus;
  recommendedStrength: number; baseName?: string; nImages?: number;
  maxTrainSteps?: number; resolution?: number; hasLora: boolean;
  published: boolean; meanSimilarity?: number;
}
interface GalleryFile { name: string; url: string; type: 'image' | 'video'; }
interface GallerySection { id: string; root: string; sub: string; title: string; files: GalleryFile[]; }
interface QaIssue { code: string; severity: 'error' | 'warn' | 'info'; msg: string; }
interface QaVerdict {
  pass: boolean; score: number; issues: QaIssue[];
  redo: { should_redo: boolean; directives: { add: string[]; avoid: string[]; note: string[] } };
  vlm?: boolean | string; error?: string;
}

const STATUS: Record<CharStatus, { c: string; label: string }> = {
  new:        { c: '#90a4ae', label: 'new' },
  configured: { c: '#42a5f5', label: 'configured' },
  trained:    { c: '#ab47bc', label: 'trained' },
  validated:  { c: '#26a69a', label: 'validated' },
  published:  { c: '#66bb6a', label: 'published' },
};

const copy = (t: string) => { try { navigator.clipboard?.writeText(t); } catch { /* clipboard blocked */ } };

function Chip({ children, color }: { children: ComponentChildren; color: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      background: `${color}22`, color, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function btn(color: string): JSX.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
    color, background: `${color}1a`, border: `1px solid ${color}55`,
    borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
  };
}
const sev = (s: string): string => (s === 'error' ? '#ef5350' : s === 'warn' ? '#ffa726' : '#90a4ae');

function CharacterCard({ ch, onChanged }: { ch: Character; onChanged: () => void }) {
  const [cmd, setCmd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = STATUS[ch.status] || STATUS.new;

  async function showTrain() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiGet<{ ok: boolean; trainCommand?: string }>(`/api/characters/${ch.name}`);
      setCmd(r.trainCommand || `(run \`cstudio config ${ch.name}\` first)`);
    } catch { setCmd(`(could not load — run \`cstudio config ${ch.name}\`)`); }
    setBusy(false);
  }
  async function configure() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<{ ok: boolean; trainCommand?: string; out?: string }>(`/api/characters/${ch.name}/config`, {});
      setCmd(r.trainCommand || null);
      setMsg(r.ok ? 'config written — copy the command below and run it when the box is idle' : (r.out || 'config failed'));
      onChanged();
    } catch (e) { setMsg(String(e)); }
    setBusy(false);
  }
  async function publish() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<{ ok: boolean; out?: string }>(`/api/characters/${ch.name}/publish`, {});
      setMsg(r.ok ? '✓ published into ComfyUI (symlink — 0 bytes on C:)' : (r.out || 'publish failed'));
      onChanged();
    } catch (e) { setMsg(String(e)); }
    setBusy(false);
  }

  return (
    <div style={{
      border: '1px solid #2a2f3a', borderRadius: 12, padding: 16, background: '#14171f',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Drama size={18} style={{ color: '#ab47bc' }} />
          <strong style={{ fontSize: 15 }}>{ch.name}</strong>
          {ch.klass && <span style={{ fontSize: 12, color: '#90a4ae' }}>· {ch.klass}</span>}
        </div>
        <Chip color={s.c}>{s.label}</Chip>
      </div>

      <button onClick={() => copy(ch.trigger)} title="copy trigger word"
        style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
          fontFamily: MONO, fontSize: 13, color: '#e0e0e0', background: '#1c2029',
          border: '1px solid #333', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
        {ch.trigger} <Copy size={12} style={{ opacity: 0.6 }} />
      </button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#9aa4b2' }}>
        {ch.baseName && <span>base: {ch.baseName.replace(/\.safetensors$/, '')}</span>}
        {ch.nImages != null && <span>· {ch.nImages} imgs</span>}
        {ch.maxTrainSteps != null && <span>· {ch.maxTrainSteps} steps</span>}
        {ch.resolution != null && <span>· {ch.resolution}px</span>}
        {ch.meanSimilarity != null && (
          <span style={{ color: ch.meanSimilarity >= 0.55 ? '#66bb6a' : '#ef5350' }}>
            · identity {ch.meanSimilarity.toFixed(2)}
          </span>
        )}
        <span>· strength {ch.recommendedStrength}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {!ch.hasLora && (
          <button disabled={busy} onClick={configure} style={btn('#42a5f5')}>
            <Play size={13} /> Write train config
          </button>
        )}
        {!ch.hasLora && (
          <button disabled={busy} onClick={showTrain} style={btn('#7e8aa0')}>
            Show train command
          </button>
        )}
        {ch.hasLora && !ch.published && (
          <button disabled={busy} onClick={publish} style={btn('#66bb6a')}>
            <Upload size={13} /> Publish to ComfyUI
          </button>
        )}
        {ch.published && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#66bb6a' }}>
            <CheckCircle2 size={14} /> live in Create — prompt with <code style={{ fontFamily: MONO }}>{ch.trigger}</code>
          </span>
        )}
      </div>

      {cmd && (
        <pre onClick={() => copy(cmd)} title="click to copy" style={{
          margin: 0, padding: 10, background: '#0d0f14', border: '1px solid #2a2f3a',
          borderRadius: 8, fontSize: 12, fontFamily: MONO, color: '#a5d6a7',
          overflowX: 'auto', cursor: 'pointer',
        }}>{cmd}</pre>
      )}
      {msg && <div style={{ fontSize: 12, color: '#cfd3da' }}>{msg}</div>}
    </div>
  );
}

function QaPanel() {
  const { data } = useFetch<GallerySection[]>('/api/gallery', 60_000);
  const [verdict, setVerdict] = useState<QaVerdict | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sections = Array.isArray(data) ? data : [];
  const gens = sections
    .filter((s) => ['comfyui', 'generated', 'video', 'nano'].includes(s.root))
    .flatMap((s) => s.files.slice(0, 8).map((f) => ({ ...f, root: s.root, sub: s.sub })));

  async function review(item: { root: string; sub: string; name: string }) {
    setBusy(true); setTarget(item.name); setVerdict(null);
    try {
      const r = await apiPost<{ ok: boolean; verdict: QaVerdict }>('/api/qa/review', item);
      setVerdict(r.verdict);
    } catch (e) {
      setVerdict({ pass: false, score: 0, issues: [{ code: 'err', severity: 'error', msg: String(e) }],
        redo: { should_redo: false, directives: { add: [], avoid: [], note: [] } } });
    }
    setBusy(false);
  }

  return (
    <div style={{ border: '1px solid #2a2f3a', borderRadius: 12, padding: 16, background: '#14171f' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <ShieldCheck size={18} style={{ color: '#26a69a' }} />
        <strong>Auto-QA gate</strong>
        <span style={{ fontSize: 12, color: '#90a4ae' }}>— click a recent gen to check it for defects + get redo directives</span>
      </div>
      {gens.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6b7280', padding: '8px 0' }}>No recent gens to review yet — make one in Create.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0' }}>
          {gens.slice(0, 16).map((g) => (
            <button key={g.url} onClick={() => review(g)} disabled={busy}
              style={{ position: 'relative', flex: '0 0 auto', border: target === g.name ? '2px solid #26a69a' : '1px solid #333',
                borderRadius: 8, padding: 0, background: '#0d0f14', cursor: 'pointer', width: 72, height: 72, overflow: 'hidden' }}>
              {g.type === 'video'
                ? <Clapperboard size={22} style={{ color: '#7e8aa0', margin: 22 }} />
                : <img src={g.url} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </button>
          ))}
        </div>
      )}
      {busy && <div style={{ fontSize: 12, color: '#90a4ae', marginTop: 8 }}><RefreshCw size={12} /> reviewing…</div>}
      {verdict && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {verdict.pass
              ? <Chip color="#66bb6a">✓ PASS · {Math.round(verdict.score * 100)}%</Chip>
              : <Chip color="#ef5350">✗ FAIL · {Math.round(verdict.score * 100)}%</Chip>}
            {verdict.vlm === true && <Chip color="#ab47bc">AI-eye checked</Chip>}
            {verdict.vlm === 'unavailable' && <span style={{ fontSize: 11, color: '#6b7280' }}>(measured-only; VLM not installed)</span>}
          </div>
          {verdict.issues.filter((i) => i.severity !== 'info').length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {verdict.issues.map((i, k) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <AlertTriangle size={13} style={{ color: sev(i.severity) }} />
                  <code style={{ fontFamily: MONO, color: sev(i.severity) }}>{i.code}</code>
                  <span style={{ color: '#b0b6c0' }}>{i.msg}</span>
                </div>
              ))}
            </div>
          )}
          {(verdict.redo.directives.add.length + verdict.redo.directives.note.length) > 0 && (
            <div style={{ fontSize: 12, color: '#9aa4b2', borderTop: '1px solid #2a2f3a', paddingTop: 8 }}>
              <strong style={{ color: '#cfd3da' }}>redo:</strong>{' '}
              {[...verdict.redo.directives.add.map((a) => `+${a}`), ...verdict.redo.directives.note].join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KeyframePanel() {
  const { data } = useFetch<GallerySection[]>('/api/gallery', 60_000);
  const [init, setInit] = useState<{ root: string; sub: string; name: string; url: string } | null>(null);
  const [motion, setMotion] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const sections = Array.isArray(data) ? data : [];
  const stills = sections
    .filter((s) => ['comfyui', 'generated', 'nano'].includes(s.root))
    .flatMap((s) => s.files.filter((f) => f.type === 'image').slice(0, 8).map((f) => ({ ...f, root: s.root, sub: s.sub })));

  async function animate() {
    if (!init) return;
    setBusy(true); setMsg(null); setResultUrl(null);
    try {
      const r = await apiPost<{ ok: boolean; url?: string; error?: string }>('/api/comfy/keyframe-video', {
        init: { root: init.root, sub: init.sub, name: init.name }, prompt: motion || undefined,
      });
      if (r.ok && r.url) { setResultUrl(r.url); setMsg('✓ rendered'); }
      else setMsg(r.error || 'failed');
    } catch (e) { setMsg(String(e)); }
    setBusy(false);
  }

  return (
    <div style={{ border: '1px solid #2a2f3a', borderRadius: 12, padding: 16, background: '#14171f' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Clapperboard size={18} style={{ color: '#ab47bc' }} />
        <strong>Keyframe → motion</strong>
        <span style={{ fontSize: 12, color: '#90a4ae' }}>— pin a still, add only motion (no character drift). Heavy GPU gen — preflight-gated.</span>
      </div>
      {stills.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6b7280', padding: '8px 0' }}>No stills to animate yet — make one in Create (a character keyframe is ideal).</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0' }}>
            {stills.slice(0, 16).map((g) => (
              <button key={g.url} onClick={() => setInit(g)} disabled={busy} title={g.name}
                style={{ flex: '0 0 auto', border: init?.name === g.name ? '2px solid #ab47bc' : '1px solid #333',
                  borderRadius: 8, padding: 0, background: '#0d0f14', cursor: 'pointer', width: 72, height: 72, overflow: 'hidden' }}>
                <img src={g.url} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input value={motion} onInput={(e) => setMotion((e.target as HTMLInputElement).value)}
              placeholder="motion only (e.g. a slow head turn, a blink) — leave blank for subtle"
              style={{ flex: 1, minWidth: 220, padding: '8px 10px', borderRadius: 8, border: '1px solid #333',
                background: '#0d0f14', color: '#e0e0e0', fontSize: 13 }} />
            <button disabled={!init || busy} onClick={animate} style={btn('#ab47bc')}>
              {busy ? <RefreshCw size={13} /> : <Clapperboard size={13} />} Animate keyframe
            </button>
          </div>
          {msg && <div style={{ fontSize: 12, color: resultUrl ? '#66bb6a' : '#cfd3da', marginTop: 8 }}>{msg}</div>}
          {resultUrl && <video src={resultUrl} controls style={{ marginTop: 10, maxWidth: 280, borderRadius: 8 }} />}
        </>
      )}
    </div>
  );
}

export function CharacterStudio() {
  const { data, loading, error, refresh } = useFetch<{ ok: boolean; characters: Character[] }>('/api/characters', 30_000);
  const characters = data?.characters || [];
  const showState = loading || !!error || characters.length === 0;

  return (
    <div style={{ padding: '0 4px 40px' }}>
      <PageHeader title="Character Studio" />

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, margin: '4px 0 20px',
        padding: 14, borderRadius: 12, background: '#111722', border: '1px solid #1e2a3a',
      }}>
        <Sparkles size={18} style={{ color: '#ffca28', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, color: '#aeb6c2', lineHeight: 1.5 }}>
          A trained character is your own AI actor: a small LoRA that learns one face/body, summoned by a
          trigger word. Workflow — <b style={{ color: '#fff' }}>new → dataset → config → train → validate → use</b>.
          Training runs on the 8GB GPU (a one-time heavy step you launch); everything else is instant.
          Trained LoRAs publish into ComfyUI so they appear in <b style={{ color: '#fff' }}>Create</b> automatically.
          <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 12, color: '#7e8aa0' }}>
            CLI:&nbsp;<span style={{ color: '#a5d6a7' }}>cstudio new jane --trigger ohwx_jane</span> ·
            <span style={{ color: '#a5d6a7' }}> cstudio dataset jane</span> ·
            <span style={{ color: '#a5d6a7' }}> cstudio config jane</span> ·
            <span style={{ color: '#a5d6a7' }}> cstudio train jane --go</span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}><QaPanel /></div>
      <div style={{ marginBottom: 24 }}><KeyframePanel /></div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <ImageIcon size={16} style={{ color: '#90a4ae' }} />
        <h3 style={{ margin: 0, fontSize: 15 }}>Roster</h3>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{characters.length}</span>
      </div>

      {showState ? (
        <PageState loading={loading} error={error} empty={!loading && !error && characters.length === 0}
          emptyTitle="No characters yet"
          emptyDescription="Create one with `cstudio new <name> --trigger <word>`, drop ~20–40 photos in its dataset_raw/, then run `cstudio dataset` + `cstudio config`." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {characters.map((ch) => <CharacterCard key={ch.name} ch={ch} onChanged={refresh} />)}
        </div>
      )}
    </div>
  );
}
