// Create — generate media into the Gallery, with selectable engines per tab.
//   Image: Nano Banana (Gemini) | Local SDXL-Turbo (on-GPU) | ComfyUI (on-GPU)
//   Video: Local LTX-Video (free, on-GPU) OR the embedded Free Video Maker app.
// Everything saves into gallery-watched folders, so output appears in /gallery automatically.
import type { JSX } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { PageHeader, Tab } from '@/components/PageHeader';
import { apiPost, dashboardToken } from '@/lib/api';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const withTok = (u: string) => (dashboardToken ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}` : u);
const VIDEO_URL = 'http://localhost:8765/';

// ── Module-level ComfyUI model cache (avoids refetch on engine toggle) ────────
// family/baseModel/triggers/verified come from the server, sourced from Civitai
// (see src/modelmeta.ts) — NOT guessed in the UI.
type ModelInfo = { name: string; family?: string; baseModel?: string; triggers?: string[]; verified?: boolean; thumb?: string };
type ComfyModels = { checkpoints: (ModelInfo & { sizeGB: number })[]; loras: (ModelInfo & { sizeMB: number })[] };
let comfyModelCache: ComfyModels | null = null;

// ── localStorage preference helpers ──────────────────────────────────────────
function loadPref<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(`create.${key}`); return v !== null ? JSON.parse(v) as T : def; } catch { return def; }
}
function savePref<T>(key: string, val: T) {
  try { localStorage.setItem(`create.${key}`, JSON.stringify(val)); } catch {}
}

interface GenResult { ok: boolean; file?: string; url?: string; notes?: string; error?: string; seed?: number; }

// ── Progress + UX helpers ─────────────────────────────────────────────────────
const fmtMs = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// Expected durations (ms) used to ease the perceived-progress bar toward ~95%.
// Generous (cold-load) values so the bar keeps creeping instead of stalling at 95%.
const EST_MS: Record<string, number> = { 'sdxl-turbo': 16000, 'sd-turbo': 10000, banana: 25000, comfyui: 75000, ltx: 200000 };
// Asymptotic ease toward 0.95 over the engine's expected duration (never hits 1 until done).
const estProgress = (elapsedMs: number, tauMs: number) => 0.95 * (1 - Math.exp(-elapsedMs / (tauMs * 0.6)));

function friendlyError(raw?: string): { msg: string; hint?: string } {
  const e = (raw || '').toString();
  if (/CUDA out of memory|OutOfMemory|GPU out of memory|free VRAM/i.test(e)) return { msg: 'GPU ran out of memory.', hint: 'Close BlueStacks/WSA (or any other GPU app) to free VRAM, then retry.' };
  if (/credits are depleted|RESOURCE_EXHAUSTED|\b429\b|billing/i.test(e)) return { msg: 'Gemini image credits are depleted.', hint: 'Add credits at ai.studio, or switch to the free Local / ComfyUI engine.' };
  if (/preflight|GPU-SAFETY BLOCKED|another GPU job/i.test(e)) return { msg: 'Blocked by the GPU safety guard.', hint: 'Another GPU job is running, or disk/VRAM is low — wait for it to finish, then retry.' };
  if (/ComfyUI failed to start|\b503\b/i.test(e)) return { msg: 'ComfyUI didn’t start in time.', hint: 'Click “Start ComfyUI”, wait for ● online (~30–60s), then generate.' };
  if (/timed out|timeout|killed/i.test(e)) return { msg: 'Generation timed out.', hint: 'First run loads the model (slow). Retry once it’s warm, or lower steps/size.' };
  if (/still downloading/i.test(e)) return { msg: 'Model is still downloading.', hint: 'One-time multi-GB download — try again in a few minutes.' };
  if (/not installed|INSTALL/i.test(e)) return { msg: 'Local generator isn’t ready yet.', hint: 'Dependencies are still installing — try again shortly.' };
  return { msg: e || 'Generation failed.' };
}

// ── Prompt history (localStorage, last 10) ────────────────────────────────────
const PROMPT_HIST_KEY = 'promptHistory';
const loadPromptHistory = (): string[] => loadPref<string[]>(PROMPT_HIST_KEY, []);
function pushPromptHistory(p: string) {
  const t = (p || '').trim(); if (!t) return;
  const cur = loadPromptHistory().filter((x) => x !== t);
  cur.unshift(t);
  savePref(PROMPT_HIST_KEY, cur.slice(0, 10));
}

// One-time keyframes for the spinner + progress shimmer.
const CC_ANIM_CSS = '@keyframes cc-spin{to{transform:rotate(360deg)}}.cc-spin{display:inline-block;animation:cc-spin 0.9s linear infinite}';

// ── Banana models ────────────────────────────────────────────────────────────
const BANANA_MODELS = [
  { value: 'flash',     label: 'Flash — Nano Banana 2 (fast, thinking)' },
  { value: 'pro',       label: 'Pro — Nano Banana Pro (high fidelity)' },
  { value: 'grounded',  label: 'Grounded — Flash + web/image search' },
];

// ── Local models ─────────────────────────────────────────────────────────────
const LOCAL_IMG_MODELS = [
  { value: 'sdxl-turbo', label: 'SDXL-Turbo (free, sharper)' },
  { value: 'sd-turbo',   label: 'SD-Turbo (free, lighter/faster)' },
];

// ── ComfyUI sizes ─────────────────────────────────────────────────────────────
const COMFY_SIZES = [
  { value: '512x768',   label: 'Portrait 512×768 (fast, default)' },
  { value: '768x512',   label: 'Landscape 768×512' },
  { value: '512x512',   label: 'Square 512×512' },
  { value: '768x1024',  label: 'Portrait 768×1024 (high-res, slower)' },
  { value: '1024x768',  label: 'Landscape 1024×768 (high-res, slower)' },
];
// ── Model-family display (label + colour). Families come from the server,
//    sourced from Civitai's `baseModel`. `other` = couldn't be determined.
const FAM: Record<string, { label: string; emoji: string; color: string }> = {
  pony:        { label: 'Pony',        emoji: '🟠', color: '#ffb347' },
  sdxl:        { label: 'SDXL',        emoji: '🔵', color: '#7fd1ff' },
  illustrious: { label: 'Illustrious', emoji: '🟣', color: '#c08cff' },
  sd15:        { label: 'SD 1.5',      emoji: '🔴', color: '#ef5350' },
  flux:        { label: 'Flux',        emoji: '🟡', color: '#ffe066' },
  other:       { label: 'Unknown',     emoji: '⚪', color: 'var(--color-text-muted)' },
};
const famInfo = (f?: string) => FAM[f || 'other'] ?? FAM.other;
const cleanName = (n: string) => n.replace(/\.(safetensors|ckpt|gguf)$/i, '');

// A LoRA is compatible unless BOTH it and the base model have a KNOWN family that
// differ. If either family is unknown we can't prove a mismatch, so we allow it.
function loraCompatible(loraFam?: string, ckptFam?: string): boolean {
  if (!ckptFam || ckptFam === 'other') return true;
  if (!loraFam || loraFam === 'other') return true;
  return loraFam === ckptFam;
}

// ── Per-FAMILY "how to get the best image" tips (keyed by family, so any future
//    Civitai download of that family gets the right advice — no per-file upkeep).
//    prefix = quality tags to prepend; neg = tags to add to the negative prompt.
const FAM_TIPS: Record<string, { prefix?: string; neg?: string; steps: string; size: string; note: string }> = {
  pony: {
    prefix: 'score_9, score_8_up, score_7_up, score_6_up',
    neg: 'score_4, score_5, score_6',
    steps: '20–30', size: 'Portrait 768×1024',
    note: 'Pony NEEDS the score_ quality tags at the START of the prompt — without them output looks washed-out. Also add score_4/5/6 to the negative.',
  },
  sdxl: {
    prefix: 'RAW photo, 8k uhd, highly detailed',
    steps: '25–35', size: 'Portrait 768×1024 (avoid 512)',
    note: 'Write natural, descriptive prompts. SDXL is trained near 1024px, so very small sizes hurt quality.',
  },
  sd15: {
    steps: '25–35', size: 'Portrait 512×768 (avoid 1024)',
    note: 'SD 1.5 is trained at 512px — going large (1024) often duplicates/warps bodies. Best for close-up faces & skin.',
  },
  illustrious: {
    prefix: 'masterpiece, best quality, highres',
    steps: '24–32', size: 'Portrait 768×1024',
    note: 'Illustrious / NoobAI use danbooru-style tags. Lead with quality tags, then comma-separated tags.',
  },
  flux: {
    steps: '20–28', size: 'Square 512×512 / 1024',
    note: 'Flux wants plain natural-language prompts, a LOW guidance, and ignores negatives. (Needs a Flux base model — none installed yet.)',
  },
  other: { steps: '20–30', size: 'Portrait 768×1024', note: 'Unknown family — use natural prompts and moderate steps.' },
};

// ── Aspect ratios ─────────────────────────────────────────────────────────────
const BANANA_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '1:4', '4:1', '1:8', '8:1'];
const BANANA_SIZES   = ['512', '1K', '2K', '4K'];

// ── Shared style objects (CSS-var aware) ───────────────────────────────────────
const S = {
  select: {
    background: 'var(--color-card)', color: 'var(--color-text)',
    border: '1px solid var(--color-border)', borderRadius: '6px',
    padding: '8px 10px', fontSize: '13px', fontFamily: MONO, cursor: 'pointer',
  } as JSX.CSSProperties,
  label: {
    fontSize: '10px', color: 'var(--color-text-faint)',
    letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO,
  } as JSX.CSSProperties,
  ta: {
    width: '100%', background: 'var(--color-card)', color: 'var(--color-text)',
    border: '1px solid var(--color-border)', borderRadius: '8px',
    padding: '12px', fontSize: '14px', fontFamily: 'inherit',
    resize: 'vertical' as const, boxSizing: 'border-box' as const,
  },
  card: {
    background: 'var(--color-card)', border: '1px solid var(--color-border)',
    borderRadius: '10px', padding: '20px',
  } as JSX.CSSProperties,
  errBox: {
    marginTop: '10px', border: '1px solid rgba(239,83,80,0.3)',
    background: 'rgba(239,83,80,0.08)', borderRadius: '8px',
    padding: '10px 14px', fontSize: '12px', color: '#ef5350', fontFamily: MONO,
  } as JSX.CSSProperties,
};

interface SysInfo {
  preflight: { ok: boolean; reason?: string };
  stale: boolean;
  staleness: number;
  metrics: {
    hw?: { cpu_pct?: number; ram_free_mb?: number; ram_pct?: number; gpu_temp?: number; gpu_util?: number; vram_used_mb?: number; vram_free_mb?: number } | null;
    disk?: { c_free_gb?: number; c_pct?: number } | null;
  };
}

// Always-visible health strip — green "Safe to generate" / red "Blocked".
// The server gate is the real enforcement; this just lets the phone see status
// and avoids a wasted round-trip when it's already unsafe.
function StatusStrip({ sys }: { sys: SysInfo | null }) {
  if (!sys) return null;
  const ok = sys.preflight?.ok !== false;
  const hw = sys.metrics?.hw || {};
  const disk = sys.metrics?.disk || {};
  const chip = (label: string, val: string) => (
    <span style={{ fontFamily: MONO, fontSize: '11px', color: 'var(--color-text-muted)' }}>{label} <b style={{ color: 'var(--color-text)' }}>{val}</b></span>
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
      padding: '8px 14px', margin: '0 24px', marginTop: '12px', borderRadius: '8px',
      background: ok ? 'rgba(52,211,154,0.08)' : 'rgba(244,90,90,0.10)',
      border: `1px solid ${ok ? 'rgba(52,211,154,0.35)' : 'rgba(244,90,90,0.45)'}`,
    }}>
      <span style={{ fontFamily: MONO, fontSize: '12px', fontWeight: 700, color: ok ? '#34d39a' : '#f45a5a' }}>
        {ok ? '● Safe to generate' : '✕ Blocked'}
      </span>
      {!ok && sys.preflight?.reason && (
        <span style={{ fontFamily: MONO, fontSize: '11px', color: '#f45a5a' }}>{sys.preflight.reason}</span>
      )}
      {disk.c_free_gb != null && chip('C:', `${disk.c_free_gb}G free`)}
      {hw.ram_free_mb != null && chip('RAM', `${(hw.ram_free_mb / 1024).toFixed(1)}G free`)}
      {hw.vram_used_mb != null && chip('VRAM', `${(hw.vram_used_mb / 1024).toFixed(1)}/8G`)}
      {hw.gpu_temp != null && chip('GPU', `${hw.gpu_temp}°C`)}
      {sys.stale && <span style={{ fontFamily: MONO, fontSize: '10px', color: 'var(--color-text-faint)' }}>(telemetry stale)</span>}
    </div>
  );
}

function genBtnStyle(enabled: boolean): JSX.CSSProperties {
  return {
    fontSize: '14px', fontWeight: 700, fontFamily: MONO, letterSpacing: '0.5px',
    color: enabled ? '#06210f' : 'var(--color-text-faint)',
    background: enabled ? '#34d39a' : 'var(--color-elevated)',
    border: 'none', borderRadius: '8px', padding: '10px 22px',
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}
function presetBtnStyle(active: boolean): JSX.CSSProperties {
  return {
    fontSize: '11px', fontWeight: 700, fontFamily: MONO, letterSpacing: '1px',
    padding: '5px 12px', borderRadius: '6px', cursor: 'pointer',
    color: active ? '#06210f' : 'var(--color-text-muted)',
    background: active ? '#34d39a' : 'var(--color-elevated)',
    border: '1px solid ' + (active ? '#34d39a' : 'var(--color-border)'),
  };
}

// ── Animated progress bar (perceived estimate OR real ComfyUI step data) ──────
function ProgressBar({ pct, label, sub }: { pct: number; label: string; sub?: string }) {
  const p = Math.max(2, Math.min(100, Math.round(pct * 100)));
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
        <span style={{ fontSize: '12px', color: '#34d39a', fontFamily: MONO }}><span class="cc-spin">⟳</span> {label}</span>
        {sub && <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO }}>{sub}</span>}
      </div>
      <div style={{ height: '6px', background: 'var(--color-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${p}%`, background: '#34d39a', borderRadius: '4px', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

const actBtn: JSX.CSSProperties = {
  fontSize: '11px', fontFamily: MONO, padding: '4px 10px', borderRadius: '6px',
  cursor: 'pointer', color: 'var(--color-text-muted)', background: 'var(--color-elevated)',
  border: '1px solid var(--color-border)', textDecoration: 'none', display: 'inline-block',
};

// ── Result display (with download / copy / regenerate / new-seed / send-to-video)
function ResultBox({ result, kind, prompt, onRegenerate, onNewSeed, onSendToVideo }: {
  result: GenResult; kind: 'image' | 'video'; prompt?: string;
  onRegenerate?: () => void; onNewSeed?: () => void; onSendToVideo?: () => void;
}) {
  if (result.ok && result.url) {
    const dl = withTok(result.url);
    return (
      <div style={{ marginTop: '12px', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden', background: 'var(--color-card)' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--color-border)', fontSize: '12px', color: '#34d39a', fontFamily: MONO }}>
          ✓ Saved · {result.file}
          {result.seed !== undefined && <span style={{ color: 'var(--color-text-faint)' }}> · seed {result.seed}</span>}
          {result.notes && <div style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>{result.notes}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '14px', background: 'var(--color-bg)' }}>
          {kind === 'video'
            ? <video src={dl} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '6px' }} />
            : <img src={dl} alt={result.file} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '6px' }} />}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px' }}>
          <a href={dl} download={result.file} style={actBtn}>↓ Download</a>
          {prompt && <button type="button" style={actBtn} onClick={() => { try { navigator.clipboard.writeText(prompt); } catch {} }}>⧉ Copy prompt</button>}
          {onRegenerate && <button type="button" style={actBtn} onClick={onRegenerate}>↻ Regenerate</button>}
          {onNewSeed && <button type="button" style={actBtn} onClick={onNewSeed}>🎲 New seed</button>}
          {kind === 'image' && onSendToVideo && <button type="button" style={actBtn} onClick={onSendToVideo}>🎬 To video</button>}
          <a href="/gallery" style={{ ...actBtn, color: '#7fd1ff', borderColor: 'rgba(127,209,255,0.3)' }}>→ Gallery</a>
        </div>
      </div>
    );
  }
  const fe = friendlyError(result.error);
  return (
    <div style={{ marginTop: '12px', border: '1px solid rgba(239,83,80,0.3)', background: 'rgba(239,83,80,0.08)', borderRadius: '10px', padding: '12px 16px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef5350', fontFamily: MONO, marginBottom: '4px' }}>{fe.msg}</div>
      {fe.hint && <div style={{ fontSize: '12px', color: '#e0a0a0', fontFamily: MONO, marginBottom: result.error ? '6px' : 0 }}>{fe.hint}</div>}
      {result.error && fe.msg !== result.error && <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO }}>{result.error}</div>}
      <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {onRegenerate && <button type="button" style={actBtn} onClick={onRegenerate}>↻ Retry</button>}
      </div>
    </div>
  );
}

// ── Batch results grid ────────────────────────────────────────────────────────
function BatchGrid({ results }: { results: GenResult[] }) {
  if (!results.length) return null;
  const ok = results.filter((r) => r.ok && r.url);
  const failed = results.filter((r) => !r.ok);
  return (
    <div style={{ marginTop: '16px' }}>
      {ok.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: '#34d39a', fontFamily: MONO, marginBottom: '8px' }}>
            ✓ {ok.length}/{results.length} generated · <a href="/gallery" style={{ color: '#7fd1ff' }}>View in Gallery →</a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            {ok.map((r, i) => (
              <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden', background: 'var(--color-card)' }}>
                <img src={withTok(r.url!)} alt={r.file} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                <div style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {failed.map((r, i) => (
        <div key={i} style={S.errBox}>✗ {r.error}</div>
      ))}
    </div>
  );
}

// ── Nano Banana presets (module-scope — static, no need to recreate per render)
const BANANA_PRESETS = [
  { label: '/nano-banana', tip: 'Flash — fast, thinking enabled', model: 'flash' },
  { label: '/nano-banana-pro', tip: 'Pro — high fidelity, advanced reasoning', model: 'pro' },
  { label: '/nano-banana-grounded', tip: 'Grounded — Flash + live web/image search', model: 'grounded' },
];

// ── Main component ────────────────────────────────────────────────────────────
export function Create() {
  const [tab, setTab] = useState<'image' | 'video'>(
    typeof window !== 'undefined' && window.location.hash === '#video' ? 'video' : 'image',
  );

  // image engine
  type ImgEngine = 'banana' | 'local' | 'comfyui';
  // Pollinations removed (it became a paid/402 service). Default to free local gen;
  // sanitize any saved 'pollinations' preference back to a free engine.
  const [imgEngine, setImgEngine] = useState<ImgEngine>(() => {
    const v = loadPref('imgEngine', 'local') as ImgEngine;
    return (v as string) === 'pollinations' ? 'local' : v;
  });

  // Simple mode (default) = pick a model → optional style → prompt → Generate.
  // Everything else (engine/size/steps/seed/negative/strength) is auto-defaulted
  // and good-quality tags + triggers are injected silently. Advanced shows it all.
  const [simpleMode, setSimpleMode] = useState<boolean>(() => loadPref('simpleMode', true));

  // banana state
  const [prompt, setPrompt] = useState('');
  const [bnModel, setBnModel] = useState(() => loadPref('bnModel', 'flash'));
  const [bnAspect, setBnAspect] = useState(() => loadPref('bnAspect', '1:1'));
  const [bnSize, setBnSize] = useState(() => loadPref('bnSize', '2K'));

  // local state
  const [localModel, setLocalModel] = useState(() => loadPref('localModel', 'sdxl-turbo'));

  // comfyui state
  // Trigger words the user explicitly removed from the auto-add list.
  const [droppedTriggers, setDroppedTriggers] = useState<string[]>([]);
  const [comfySize, setComfySize] = useState(() => loadPref('comfySize', '512x768'));
  const [comfySteps, setComfySteps] = useState(() => loadPref('comfySteps', 20));
  const [comfyNeg, setComfyNeg] = useState('deformed, ugly, blurry, low quality, bad anatomy, watermark, text');
  const [comfyCheckpoint, setComfyCheckpoint] = useState('');
  const [comfyLoras, setComfyLoras] = useState<string[]>([]);
  const [comfyLoraStrength, setComfyLoraStrength] = useState(() => loadPref('comfyLoraStrength', 0.8));
  const [comfyModels, setComfyModels] = useState<ComfyModels | null>(comfyModelCache);
  const [comfyOnline, setComfyOnline] = useState<boolean | null>(comfyModelCache ? true : null);

  // ── Persist key preferences on change ────────────────────────────────────
  useEffect(() => { savePref('imgEngine', imgEngine); }, [imgEngine]);
  useEffect(() => { savePref('simpleMode', simpleMode); }, [simpleMode]);
  // Simple mode always uses ComfyUI (the engine with named Civitai models + LoRAs).
  useEffect(() => { if (simpleMode && tab === 'image' && imgEngine !== 'comfyui') setImgEngine('comfyui'); }, [simpleMode, tab, imgEngine]);
  useEffect(() => { savePref('bnModel', bnModel); }, [bnModel]);
  useEffect(() => { savePref('bnAspect', bnAspect); }, [bnAspect]);
  useEffect(() => { savePref('bnSize', bnSize); }, [bnSize]);
  useEffect(() => { savePref('localModel', localModel); }, [localModel]);
  useEffect(() => { savePref('comfySize', comfySize); }, [comfySize]);
  useEffect(() => { savePref('comfySteps', comfySteps); }, [comfySteps]);
  useEffect(() => { savePref('comfyLoraStrength', comfyLoraStrength); }, [comfyLoraStrength]);

  // When the base model changes, drop any selected LoRAs whose family no longer
  // matches — so an incompatible combo can never be submitted.
  useEffect(() => {
    if (imgEngine !== 'comfyui' || !comfyModels) return;
    const fam = comfyModels.checkpoints?.find(c => c.name === comfyCheckpoint)?.family;
    setComfyLoras(prev => prev.filter(n => loraCompatible(comfyModels!.loras?.find(x => x.name === n)?.family, fam)));
  }, [comfyCheckpoint, comfyModels, imgEngine]);

  // ── Fetch ComfyUI models (cached at module level to avoid re-fetch on toggle)
  useEffect(() => {
    if (imgEngine === 'comfyui') {
      if (comfyModelCache) {
        setComfyModels(comfyModelCache);
        if (comfyModelCache.checkpoints?.length && !comfyCheckpoint) setComfyCheckpoint(comfyModelCache.checkpoints[0].name);
        setComfyOnline(true);
        return;
      }
      setComfyOnline(null);
      fetch('/api/comfyui/status')
        .then(r => r.json())
        .then((d: any) => {
          comfyModelCache = d;
          setComfyModels(d);
          if (d.checkpoints?.length && !comfyCheckpoint) setComfyCheckpoint(d.checkpoints[0].name);
          setComfyOnline(true);
        })
        .catch(() => setComfyOnline(false));
    }
  }, [imgEngine]);

  // batch state
  const [batchCount, setBatchCount] = useState(1);

  // generation state
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [batchResults, setBatchResults] = useState<GenResult[]>([]);

  // ── progress + timing (image) ─────────────────────────────────────────────
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);                 // perceived estimate 0..1
  const [comfyStep, setComfyStep] = useState<{ value: number; max: number } | null>(null);
  const genStartRef = useRef(0);

  // ── seed + quality (image) ────────────────────────────────────────────────
  const [seedVal, setSeedVal] = useState('');                  // '' = random each run
  const [seedLock, setSeedLock] = useState(false);             // reuse last result's seed
  const [localSteps, setLocalSteps] = useState<number>(() => loadPref('localSteps', 3));

  // ── ComfyUI start + prompt history ────────────────────────────────────────
  const [comfyStarting, setComfyStarting] = useState(false);
  const [promptHist, setPromptHist] = useState<string[]>(loadPromptHistory());

  // video state
  const [vidEngine, setVidEngine] = useState<'local' | 'fvm'>('local');
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidBusy, setVidBusy] = useState(false);
  const [vidResult, setVidResult] = useState<GenResult | null>(null);
  const [vidElapsedMs, setVidElapsedMs] = useState(0);
  const [vidProgress, setVidProgress] = useState(0);
  const [vidLastMs, setVidLastMs] = useState<number | null>(null);
  const [vidSeedVal, setVidSeedVal] = useState('');
  const [vidSeedLock, setVidSeedLock] = useState(false);

  // Live system health (cpu/ram/gpu/disk) + the server's preflight verdict, so
  // the phone can see whether it's safe to generate and Generate hard-disables
  // when it isn't. Mirrors what the server gate actually enforces.
  const [sys, setSys] = useState<SysInfo | null>(null);

  // Civitai model download (from the phone) — disk-gated on the server.
  const [civUrl, setCivUrl] = useState('');
  const [civToken, setCivToken] = useState(() => loadPref('civToken', ''));
  const [civDest, setCivDest] = useState(() => loadPref('civDest', 'checkpoints'));
  const [civJob, setCivJob] = useState<{ pct: number; status: string; name?: string; error?: string } | null>(null);
  const vidStartRef = useRef(0);

  // ── Effects below ALL state declarations (dep arrays must not hit the TDZ) ──
  useEffect(() => { savePref('localSteps', localSteps); }, [localSteps]);

  // Image: drive the perceived-progress bar + elapsed timer while generating.
  useEffect(() => {
    if (!busy) { setProgress(0); setComfyStep(null); return; }
    genStartRef.current = Date.now();
    setElapsedMs(0); setProgress(0);
    const key = imgEngine === 'local' ? localModel : imgEngine;
    const tau = EST_MS[key] ?? 30000;
    const id = setInterval(() => {
      const el = Date.now() - genStartRef.current;
      setElapsedMs(el);
      setProgress(estProgress(el, tau));
    }, 250);
    return () => clearInterval(id);
  }, [busy, imgEngine, localModel]);

  // Image: subscribe to REAL ComfyUI step progress over SSE during a comfy gen.
  useEffect(() => {
    if (!busy || imgEngine !== 'comfyui') return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(withTok('/api/comfy/progress'));
      es.onmessage = (ev: MessageEvent) => {
        try { const m = JSON.parse(ev.data); if (m.type === 'progress' && m.max) setComfyStep({ value: m.value, max: m.max }); } catch {}
      };
    } catch {}
    return () => { try { es?.close(); } catch {} };
  }, [busy, imgEngine]);

  // Video: perceived-progress bar + elapsed timer.
  useEffect(() => {
    if (!vidBusy) { setVidProgress(0); return; }
    vidStartRef.current = Date.now();
    setVidElapsedMs(0); setVidProgress(0);
    const id = setInterval(() => {
      const el = Date.now() - vidStartRef.current;
      setVidElapsedMs(el);
      setVidProgress(estProgress(el, EST_MS.ltx));
    }, 250);
    return () => clearInterval(id);
  }, [vidBusy]);

  // ComfyUI: auto re-poll status while offline so it flips to online on its own.
  useEffect(() => {
    if (imgEngine !== 'comfyui' || comfyOnline) return;
    const id = setInterval(() => {
      fetch('/api/comfyui/status').then(r => r.json()).then((d: any) => {
        if (d && (d.checkpoints || d.loras)) {
          comfyModelCache = d; setComfyModels(d);
          if (d.checkpoints?.length && !comfyCheckpoint) setComfyCheckpoint(d.checkpoints[0].name);
          setComfyOnline(true);
        }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [imgEngine, comfyOnline, comfyCheckpoint]);

  // Poll live system health every 10s so the strip + button-gating stay current.
  useEffect(() => {
    let alive = true;
    const tick = () => fetch(withTok('/api/system/metrics')).then(r => r.json()).then((d: SysInfo) => { if (alive) setSys(d); }).catch(() => {});
    tick();
    const id = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const bnSizeOpts = bnModel === 'pro' ? BANANA_SIZES.filter((s) => s !== '512') : BANANA_SIZES;
  // safe = server preflight says go (default true until first poll returns, so
  // the UI never blocks spuriously before health loads). The server still gates.
  const safe = !sys || sys.preflight?.ok !== false;
  const canImg = prompt.trim().length > 0 && !busy && safe && (imgEngine !== 'comfyui' || comfyCheckpoint !== '');
  const canVid = vidPrompt.trim().length > 0 && !vidBusy && safe;

  // ── Clear results when switching engine or tab ────────────────────────────
  useEffect(() => { setResult(null); setBatchResults([]); setLastMs(null); }, [tab, imgEngine]);

  function applyBananaPreset(model: string) {
    setImgEngine('banana');
    setBnModel(model);
  }

  // ── Max batch counts per engine
  const maxBatch = imgEngine === 'banana' ? 5 : imgEngine === 'comfyui' ? 1 : 3;

  // ── Selected base model + the trigger words we'll auto-add ─────────────────
  const selectedCkpt = comfyModels?.checkpoints?.find(c => c.name === comfyCheckpoint);
  const ckptFam = selectedCkpt?.family;
  const activeLoraObjs = (comfyModels?.loras || []).filter(l => comfyLoras.includes(l.name));
  // Civitai trainedWords often lists a model's whole caption vocab, not just the
  // trigger. Auto-add ONLY the primary activation word (the first non-blank one)
  // per source — injecting all would bloat the prompt and hurt the image. The
  // rest stay available for the user to type by hand.
  const primaryTrigger = (arr?: string[]): string | null => {
    const list = (arr || []).map(t => (t || '').trim()).filter(Boolean);
    return list.length ? list[0] : null;
  };
  const activeTriggers = Array.from(new Set(
    [primaryTrigger(selectedCkpt?.triggers), ...activeLoraObjs.map(l => primaryTrigger(l.triggers))].filter(Boolean) as string[],
  ));
  const effectiveTriggers = activeTriggers.filter(t => !droppedTriggers.includes(t));

  // ── Poll a queued ComfyUI job until it reports done. Uses plain fetch so a
  // single transient socket blip doesn't abort the whole generation.
  const pollComfy = (promptId: string, seed?: number): Promise<GenResult> => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      fetch(withTok(`/api/comfy/generate/${promptId}`))
        .then(x => x.json())
        .then((j: any) => {
          if (j.done) {
            resolve(j.ok
              ? { ok: true, file: j.file, url: j.url, seed: j.seed ?? seed, notes: j.notes }
              : { ok: false, error: j.error || 'generation failed', seed: j.seed ?? seed });
            return;
          }
          if (Date.now() - t0 > 620_000) { resolve({ ok: false, error: 'timed out waiting for ComfyUI output' }); return; }
          setTimeout(tick, 2000);
        })
        .catch(() => {
          if (Date.now() - t0 > 620_000) resolve({ ok: false, error: 'lost connection to server' });
          else setTimeout(tick, 3000);
        });
    };
    tick();
  });

  // ── Generate (single or batch). `override.seed` lets "New seed" force-randomize.
  const genImage = async (override?: { seed?: number }) => {
    if (!canImg) return;
    setBusy(true); setResult(null); setBatchResults([]);
    const start = Date.now();
    const seedNum = override && 'seed' in override
      ? override.seed
      : (seedVal.trim() !== '' && Number.isFinite(Number(seedVal)) ? Number(seedVal) : undefined);
    let r: GenResult = { ok: false, error: 'no result' };
    try {
      if (imgEngine === 'comfyui') {
        const [w, h] = comfySize.split('x').map(Number);
        // Auto-prepend the active trigger words (from the selected checkpoint +
        // LoRAs, minus any the user removed, minus any already typed).
        const base = prompt.trim();
        const lc = base.toLowerCase();
        const tips = FAM_TIPS[ckptFam || 'other'] ?? FAM_TIPS.other;
        // In Simple mode, silently apply the family's recommended quality tags +
        // negatives so the user gets good output without touching any knobs.
        // (Advanced mode keeps the user's prompt/negative exactly as typed.)
        const qual = (simpleMode && tips.prefix && !lc.includes(tips.prefix.toLowerCase().slice(0, 10))) ? [tips.prefix] : [];
        const toAdd = [...qual, ...effectiveTriggers].filter(t => t && !lc.includes(t.toLowerCase()));
        const fullPrompt = toAdd.length ? [...toAdd, base].filter(Boolean).join(', ') : base;
        const negOut = (simpleMode && tips.neg && !comfyNeg.toLowerCase().includes(tips.neg.toLowerCase().slice(0, 8)))
          ? (comfyNeg.trim() ? comfyNeg.replace(/\s*$/, '') + ', ' : '') + tips.neg
          : comfyNeg;
        const kick = await apiPost<{ ok: boolean; prompt_id?: string; seed?: number; error?: string }>(
          '/api/comfy/generate', {
            prompt: fullPrompt, negative_prompt: negOut, steps: comfySteps,
            width: w, height: h, checkpoint: comfyCheckpoint || undefined,
            loras: comfyLoras.length ? comfyLoras.map(name => ({ name, strength: comfyLoraStrength })) : undefined,
            ...(seedNum !== undefined ? { seed: seedNum } : {}),
          });
        if (!kick.ok || !kick.prompt_id) {
          r = { ok: false, error: kick.error || 'failed to queue generation' };
        } else {
          r = await pollComfy(kick.prompt_id, kick.seed);
        }
        setResult(r);
      } else if (batchCount > 1) {
        const body: Record<string, unknown> = { prompt: prompt.trim(), count: batchCount };
        if (imgEngine === 'banana') { body.source = 'banana'; body.model = bnModel; body.aspectRatio = bnAspect; body.size = bnSize; }
        else { body.source = 'local'; body.model = localModel; body.steps = localSteps; }
        const br = await apiPost<{ results: GenResult[] }>('/api/gallery/batch-generate', body);
        setBatchResults(br.results || []);
        r = br.results?.find((x) => x.ok) ?? br.results?.[0] ?? r;
      } else {
        let body: Record<string, unknown> = { prompt: prompt.trim() };
        if (imgEngine === 'banana') {
          body = { ...body, model: bnModel, aspectRatio: bnAspect, size: bnModel === 'pro' && bnSize === '512' ? '1K' : bnSize };
        } else {
          body = { ...body, source: 'local', model: localModel, steps: localSteps, ...(seedNum !== undefined ? { seed: seedNum } : {}) };
        }
        r = await apiPost<GenResult>('/api/gallery/generate', body);
        setResult(r);
      }
      if (r.ok) {
        setLastMs(Date.now() - start);
        pushPromptHistory(prompt); setPromptHist(loadPromptHistory());
        if (r.seed !== undefined && seedLock) setSeedVal(String(r.seed));
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const genVideo = async (override?: { seed?: number }) => {
    if (!canVid) return;
    setVidBusy(true); setVidResult(null);
    const start = Date.now();
    const seedNum = override && 'seed' in override
      ? override.seed
      : (vidSeedVal.trim() !== '' && Number.isFinite(Number(vidSeedVal)) ? Number(vidSeedVal) : undefined);
    try {
      const r = await apiPost<GenResult>('/api/gallery/generate-video', {
        prompt: vidPrompt.trim(), ...(seedNum !== undefined ? { seed: seedNum } : {}),
      });
      setVidResult(r);
      if (r.ok) {
        setVidLastMs(Date.now() - start);
        pushPromptHistory(vidPrompt); setPromptHist(loadPromptHistory());
        if (r.seed !== undefined && vidSeedLock) setVidSeedVal(String(r.seed));
      }
    } catch (e) {
      setVidResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setVidBusy(false); }
  };

  // ── Download a Civitai model from the phone — server gates on disk + cap. ──
  const downloadCivitai = async () => {
    if (!civUrl.trim() || (civJob && civJob.status === 'downloading')) return;
    savePref('civToken', civToken); savePref('civDest', civDest);
    setCivJob({ pct: 0, status: 'starting' });
    try {
      const r = await apiPost<{ ok: boolean; jobId?: string; error?: string }>('/api/models/download', {
        url: civUrl.trim(), token: civToken.trim(), dest: civDest,
      });
      if (!r.ok || !r.jobId) { setCivJob({ pct: 0, status: 'failed', error: r.error || 'refused' }); return; }
      const jobId = r.jobId;
      const poll = () => {
        fetch(withTok(`/api/models/download/${jobId}`)).then(x => x.json()).then((j: any) => {
          if (!j.ok) { setCivJob({ pct: 0, status: 'failed', error: j.error }); return; }
          setCivJob({ pct: j.pct, status: j.status, name: j.name, error: j.error });
          if (j.status === 'downloading') setTimeout(poll, 2000);
          else if (j.status === 'done') { comfyModelCache = null; }  // force model-list refresh
        }).catch(() => setTimeout(poll, 3000));
      };
      poll();
    } catch (e) {
      setCivJob({ pct: 0, status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── Start ComfyUI from the UI (when it shows ● offline), then poll to online.
  const startComfy = async () => {
    if (comfyStarting) return;
    setComfyStarting(true);
    try { await apiPost('/api/comfy/start', {}); } catch {}
    const t0 = Date.now();
    const poll = () => {
      fetch('/api/comfyui/status').then(r => r.json()).then((d: any) => {
        if (d && (d.checkpoints || d.loras)) {
          comfyModelCache = d; setComfyModels(d);
          if (d.checkpoints?.length && !comfyCheckpoint) setComfyCheckpoint(d.checkpoints[0].name);
          setComfyOnline(true); setComfyStarting(false);
        } else if (Date.now() - t0 < 90_000) { setTimeout(poll, 4000); } else { setComfyStarting(false); }
      }).catch(() => { if (Date.now() - t0 < 90_000) setTimeout(poll, 4000); else setComfyStarting(false); });
    };
    setTimeout(poll, 4000);
  };

  // ── Live progress bar label/sublabel for the image tab.
  const imgPct = comfyStep ? comfyStep.value / comfyStep.max : progress;
  const imgBarLabel = imgEngine === 'comfyui'
    ? (comfyStep ? `Sampling… Step ${comfyStep.value}/${comfyStep.max}` : 'ComfyUI starting…')
    : imgEngine === 'banana' ? 'Nano Banana working…' : 'Generating on the GPU…';

  return (
    <div class="flex flex-col h-full">
      <style>{CC_ANIM_CSS}</style>
      <PageHeader
        title="Create"
        tabs={
          <>
            <Tab
              label="🖼 Image"
              active={tab === 'image'}
              onClick={() => { setTab('image'); try { history.replaceState(null, '', '#image'); } catch {} }}
            />
            <Tab
              label="🎬 Video"
              active={tab === 'video'}
              onClick={() => { setTab('video'); try { history.replaceState(null, '', '#video'); } catch {} }}
            />
          </>
        }
      />
      <StatusStrip sys={sys} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: tab === 'video' && vidEngine === 'fvm' ? '1200px' : '900px', margin: '0 auto' }}>

          {tab === 'image' ? (
            <>
              {/* ── Simple ⇄ Advanced toggle ─────────────────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: MONO }}>
                  {simpleMode ? 'Pick a model · (optional) add a style · type what you want · Generate.' : 'All controls — engines, sizes, steps, seed, negatives, LoRA strength.'}
                </div>
                <button type="button" onClick={() => setSimpleMode(m => !m)}
                  style={{ ...actBtn, color: '#7fd1ff', borderColor: 'rgba(127,209,255,0.3)' }}>
                  {simpleMode ? '⚙ Advanced options' : '← Back to simple'}
                </button>
              </div>

              {simpleMode ? (
                /* ── SIMPLE MODE — visual model gallery → style → prompt → Generate ── */
                <div style={S.card}>
                  {comfyOnline === false && (
                    <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '13px', color: 'var(--color-text-muted)' }}>
                      <span style={{ color: '#ffb347' }}>● ComfyUI is asleep.</span>
                      <button type="button" onClick={startComfy} disabled={comfyStarting}
                        style={{ ...actBtn, fontSize: '13px', padding: '8px 14px', color: '#34d39a', borderColor: 'rgba(52,211,154,0.3)' }}>
                        {comfyStarting ? <><span class="cc-spin">⟳</span> waking up…</> : '▶ Wake it up'}
                      </button>
                    </div>
                  )}

                  {/* ── CHOOSE A MODEL — tappable picture cards ──────────────────── */}
                  <div style={{ ...S.label, fontSize: '12px', marginBottom: '10px' }}>CHOOSE A MODEL</div>
                  {comfyModels && !comfyModels.checkpoints?.length ? (
                    <div style={{ fontSize: '13px', color: 'var(--color-text-faint)', fontFamily: MONO, lineHeight: 1.6 }}>
                      No models yet — tap <b>⚙ Advanced options</b> → <b>+ Add model from Civitai</b> to download one.
                    </div>
                  ) : !comfyModels?.checkpoints?.length ? (
                    <div style={{ fontSize: '13px', color: 'var(--color-text-faint)', fontFamily: MONO }}><span class="cc-spin">⟳</span> Loading models…</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
                      {comfyModels.checkpoints.map(c => {
                        const active = c.name === comfyCheckpoint;
                        const fi = famInfo(c.family);
                        return (
                          <button key={c.name} type="button" disabled={busy}
                            onClick={() => setComfyCheckpoint(c.name)}
                            style={{
                              position: 'relative', textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer',
                              borderRadius: '12px', padding: '0', overflow: 'hidden', minHeight: '112px',
                              display: 'flex', flexDirection: 'column', fontFamily: MONO,
                              border: active ? '2px solid #34d39a' : '1px solid var(--color-border)',
                              background: 'var(--color-card)', color: 'var(--color-text)',
                              boxShadow: active ? '0 0 0 3px rgba(52,211,154,0.18)' : 'none',
                            }}>
                            {/* picture area (family-colored tile until real Civitai thumbs are wired) */}
                            <div style={{
                              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '34px', minHeight: '64px',
                              background: `linear-gradient(135deg, ${fi.color}33, ${fi.color}11)`,
                            }}>
                              {c.thumb ? <img src={c.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} /> : fi.emoji}
                              {active && <span style={{ position: 'absolute', top: '6px', right: '8px', fontSize: '14px', color: '#34d39a' }}>✓</span>}
                            </div>
                            {/* caption */}
                            <div style={{ padding: '8px 10px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanName(c.name)}</div>
                              <div style={{ fontSize: '10px', color: fi.color, marginTop: '2px' }}>{fi.emoji} {fi.label}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── ADD A STYLE — optional, compatible add-ons only ──────────── */}
                  {(() => {
                    const compat = (comfyModels?.loras || []).filter(l => loraCompatible(l.family, ckptFam));
                    if (!selectedCkpt || compat.length === 0) return null;
                    const pill = (active: boolean): JSX.CSSProperties => ({
                      fontSize: '13px', fontFamily: MONO, padding: '9px 14px', borderRadius: '999px',
                      cursor: busy ? 'not-allowed' : 'pointer', minHeight: '40px',
                      color: active ? '#06210f' : 'var(--color-text)',
                      background: active ? '#34d39a' : 'var(--color-elevated)',
                      border: '1px solid ' + (active ? '#34d39a' : 'var(--color-border)'),
                    });
                    return (
                      <div style={{ marginTop: '20px' }}>
                        <div style={{ ...S.label, fontSize: '12px', marginBottom: '10px' }}>ADD A STYLE — OPTIONAL {comfyLoras.length > 0 && <span style={{ color: '#34d39a' }}>({comfyLoras.length} on)</span>}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          <button type="button" disabled={busy} onClick={() => setComfyLoras([])} style={pill(comfyLoras.length === 0)}>
                            {comfyLoras.length === 0 ? '✓ ' : ''}None
                          </button>
                          {compat.map(l => {
                            const active = comfyLoras.includes(l.name);
                            return (
                              <button key={l.name} type="button" disabled={busy}
                                onClick={() => setComfyLoras(prev => prev.includes(l.name) ? prev.filter(x => x !== l.name) : [...prev, l.name])}
                                style={pill(active)}>
                                {active ? '✓ ' : ''}{cleanName(l.name)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── DESCRIBE IT ──────────────────────────────────────────────── */}
                  <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ ...S.label, fontSize: '12px', marginBottom: 0 }}>DESCRIBE IT</div>
                    {promptHist.length > 0 && (
                      <select value="" disabled={busy}
                        onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) setPrompt(v); (e.target as HTMLSelectElement).value = ''; }}
                        style={{ ...S.select, fontSize: '12px', padding: '6px 8px', maxWidth: '200px' }}>
                        <option value="">↩ recent…</option>
                        {promptHist.map((p, i) => <option key={i} value={p}>{p.length > 60 ? p.slice(0, 60) + '…' : p}</option>)}
                      </select>
                    )}
                  </div>
                  <textarea value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
                    placeholder="A neon-lit candlestick chart exploding upward, cinematic…"
                    rows={4} disabled={busy} style={{ ...S.ta, marginTop: '8px', fontSize: '15px' }} />
                  {effectiveTriggers.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#34d39a', fontFamily: MONO, marginTop: '6px' }}>
                      ✓ auto-adding for you: {effectiveTriggers.join(', ')}
                    </div>
                  )}

                  {/* ── GENERATE — full-width, phone-friendly ────────────────────── */}
                  <button type="button" onClick={() => genImage()} disabled={!canImg}
                    style={{ ...genBtnStyle(canImg), width: '100%', padding: '16px', fontSize: '16px', marginTop: '18px' }}>
                    {busy ? <><span class="cc-spin">⟳</span> Generating… {fmtMs(elapsedMs)}</> : '✦ Generate'}
                  </button>
                  <div style={{ textAlign: 'center', marginTop: '8px', minHeight: '16px' }}>
                    {!busy && lastMs !== null && result?.ok
                      ? <span style={{ fontSize: '12px', color: '#34d39a', fontFamily: MONO }}>✓ Generated in {fmtMs(lastMs)}</span>
                      : !busy && selectedCkpt && <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO }}>free · runs on this laptop's GPU · best quality</span>}
                  </div>
                  {busy && <ProgressBar pct={imgPct} label={imgBarLabel} sub={`${fmtMs(elapsedMs)} elapsed`} />}
                </div>
              ) : (
              <>
              {/* ── Plain-English explainer (collapsible, persists open/closed) ── */}
              <details style={{ marginBottom: '14px', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 12px' }}>
                <summary style={{ ...S.label, cursor: 'pointer', marginBottom: 0 }}>▸ HOW THIS WORKS</summary>
                <div style={{ marginTop: '10px', fontSize: '12px', lineHeight: '1.6', color: 'var(--color-text-muted)', fontFamily: MONO }}>
                  <b style={{ color: 'var(--color-text)' }}>Engine</b> — where the image is made. <b>ComfyUI</b> uses your downloaded Civitai models (best quality, runs on this laptop). <b>Quick preview</b> is fast and local. <b>Nano Banana</b> is Google's cloud — no load on the laptop.<br />
                  <b style={{ color: 'var(--color-text)' }}>Base model</b> — the foundation everything is built on. It has a family (🟠 Pony, 🔵 SDXL, 🔴 SD 1.5, …).<br />
                  <b style={{ color: 'var(--color-text)' }}>LoRAs (style add-ons)</b> — optional extras layered on top of the base model. You can stack several. Only add-ons that match your base model's family can be selected — the rest are locked 🔒 so nothing comes out broken.<br />
                  <b style={{ color: 'var(--color-text)' }}>Trigger words</b> — some add-ons need a magic word to activate; we add those to your prompt automatically (you can remove any with ×).<br />
                  <b style={{ color: '#34d39a' }}>● Safe to generate</b> at the top means the laptop has room. If it turns red, Generate is disabled until it's safe — so you can run this from your phone without watching the laptop.
                </div>
              </details>

              {/* ── Add a Civitai model (server gates on disk space + folder cap) ── */}
              <details style={{ marginBottom: '14px', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 12px' }}>
                <summary style={{ ...S.label, cursor: 'pointer', marginBottom: 0 }}>+ ADD MODEL FROM CIVITAI</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  <input type="text" placeholder="https://civitai.com/api/download/models/…" value={civUrl}
                    onInput={(e) => setCivUrl((e.target as HTMLInputElement).value)} style={S.select} />
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input type="password" placeholder="Civitai API token (optional)" value={civToken}
                      onInput={(e) => setCivToken((e.target as HTMLInputElement).value)} style={{ ...S.select, flex: 1, minWidth: '160px' }} />
                    <select value={civDest} onChange={(e) => setCivDest((e.target as HTMLSelectElement).value)} style={S.select}>
                      <option value="checkpoints">checkpoint</option>
                      <option value="loras">lora</option>
                      <option value="controlnet">controlnet</option>
                      <option value="vae">vae</option>
                    </select>
                    <button type="button" onClick={downloadCivitai}
                      disabled={!civUrl.trim() || (civJob?.status === 'downloading')}
                      style={genBtnStyle(!!civUrl.trim() && civJob?.status !== 'downloading')}>
                      {civJob?.status === 'downloading' ? `↓ ${civJob.pct}%` : '↓ Download'}
                    </button>
                  </div>
                  {civJob && civJob.status !== 'downloading' && (
                    <div style={{ fontFamily: MONO, fontSize: '11px', color: civJob.status === 'done' ? '#34d39a' : '#f45a5a' }}>
                      {civJob.status === 'done' ? `✓ Saved ${civJob.name || ''} — pick it in the checkpoint list` : `✕ ${civJob.error || 'failed'}`}
                    </div>
                  )}
                </div>
              </details>

              {/* ── Nano Banana slash-command preset buttons ───────────────────── */}
              <div style={{ marginBottom: '14px' }}>
                <div style={S.label}>NANO BANANA PRESETS</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {BANANA_PRESETS.map((p) => (
                    <button
                      key={p.model}
                      type="button"
                      title={p.tip}
                      onClick={() => applyBananaPreset(p.model)}
                      style={presetBtnStyle(imgEngine === 'banana' && bnModel === p.model)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Engine + model controls ────────────────────────────────────── */}
              <div style={S.card}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '14px' }}>
                  {/* Engine */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <div style={{ ...S.label, marginBottom: 0 }}>ENGINE</div>
                      {imgEngine === 'comfyui' && (
                        comfyOnline === null
                          ? <span style={{ fontSize: '10px', color: '#ffb347', fontFamily: MONO }}>connecting…</span>
                          : comfyOnline
                            ? <span style={{ fontSize: '10px', color: '#34d39a', fontFamily: MONO }}>● online</span>
                            : <>
                                <span style={{ fontSize: '10px', color: '#ef5350', fontFamily: MONO }}>● offline</span>
                                <button type="button" onClick={startComfy} disabled={comfyStarting}
                                  style={{ fontSize: '10px', fontFamily: MONO, padding: '2px 8px', borderRadius: '4px', cursor: comfyStarting ? 'wait' : 'pointer', color: '#34d39a', background: 'none', border: '1px solid rgba(52,211,154,0.3)' }}>
                                  {comfyStarting ? <><span class="cc-spin">⟳</span> starting…</> : '▶ Start ComfyUI'}
                                </button>
                              </>
                      )}
                    </div>
                    <select value={imgEngine} onChange={(e) => setImgEngine((e.target as HTMLSelectElement).value as ImgEngine)} disabled={busy} style={{ ...S.select, minWidth: '260px' }}>
                      <option value="local">Local — SDXL-Turbo (free, on-GPU)</option>
                      <option value="banana">Nano Banana — Gemini (paid)</option>
                      <option value="comfyui">ComfyUI — your Civitai models (free, on-GPU, best quality)</option>
                    </select>
                  </div>

                  {/* Model (engine-specific) */}
                  {imgEngine === 'banana' && (
                    <div>
                      <div style={S.label}>MODEL</div>
                      <select value={bnModel} onChange={(e) => setBnModel((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...S.select, minWidth: '260px' }}>
                        {BANANA_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                  )}
                  {imgEngine === 'local' && (
                    <>
                      <div>
                        <div style={S.label}>MODEL</div>
                        <select value={localModel} onChange={(e) => setLocalModel((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...S.select, minWidth: '240px' }}>
                          {LOCAL_IMG_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={S.label}>QUALITY</div>
                        <select value={localSteps} onChange={(e) => setLocalSteps(Number((e.target as HTMLSelectElement).value))} disabled={busy} style={{ ...S.select, minWidth: '150px' }}>
                          <option value={1}>Fast (1 step)</option>
                          <option value={3}>Balanced (3)</option>
                          <option value={6}>Quality (6)</option>
                        </select>
                      </div>
                    </>
                  )}
                  {imgEngine === 'comfyui' && (
                    <>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <div style={{ ...S.label, marginBottom: 0 }}>BASE MODEL</div>
                          {selectedCkpt && (
                            <span style={{ fontSize: '10px', fontFamily: MONO, color: famInfo(ckptFam).color, border: `1px solid ${famInfo(ckptFam).color}`, borderRadius: '4px', padding: '1px 6px' }}
                              title={selectedCkpt.baseModel ? `Civitai base model: ${selectedCkpt.baseModel}` : 'family guessed from filename'}>
                              {famInfo(ckptFam).emoji} {famInfo(ckptFam).label}{selectedCkpt.verified === false ? ' ?' : ''}
                            </span>
                          )}
                        </div>
                        <select value={comfyCheckpoint} onChange={(e) => setComfyCheckpoint((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...S.select, minWidth: '300px' }}>
                          {comfyModels?.checkpoints?.length
                            ? comfyModels.checkpoints.map(c => (
                                <option key={c.name} value={c.name}>{cleanName(c.name)} · {famInfo(c.family).label} ({c.sizeGB}GB)</option>
                              ))
                            : <option value="">Loading…</option>}
                        </select>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO, marginTop: '4px' }}>The foundation — every add-on must match this family.</div>
                      </div>
                      <div>
                        <div style={S.label}>SIZE</div>
                        <select value={comfySize} onChange={(e) => setComfySize((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...S.select, minWidth: '270px' }}>
                          {COMFY_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={S.label}>STEPS</div>
                        <select value={comfySteps} onChange={(e) => setComfySteps(Number((e.target as HTMLSelectElement).value))} disabled={busy} style={{ ...S.select, minWidth: '120px' }}>
                          {[10, 15, 20, 25, 30].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {/* Aspect ratio (Banana only) */}
                  {imgEngine === 'banana' && (
                    <div>
                      <div style={S.label}>ASPECT</div>
                      <select
                        value={bnAspect}
                        onChange={(e) => setBnAspect((e.target as HTMLSelectElement).value)}
                        disabled={busy}
                        style={S.select}
                      >
                        {BANANA_ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Size (Banana only) */}
                  {imgEngine === 'banana' && (
                    <div>
                      <div style={S.label}>SIZE</div>
                      <select value={bnSize} onChange={(e) => setBnSize((e.target as HTMLSelectElement).value)} disabled={busy} style={S.select}>
                        {bnSizeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Batch count — hidden for ComfyUI since it only supports single generation */}
                  {imgEngine !== 'comfyui' && (
                    <div>
                      <div style={S.label}>BATCH (1–{maxBatch})</div>
                      <select value={batchCount} onChange={(e) => setBatchCount(Number((e.target as HTMLSelectElement).value))} disabled={busy} style={{ ...S.select, minWidth: '80px' }}>
                        {Array.from({ length: maxBatch }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}×</option>)}
                      </select>
                    </div>
                  )}

                  {/* Seed — reproduce/vary an output (Banana has no seed control) */}
                  {imgEngine !== 'banana' && (
                    <div>
                      <div style={S.label}>SEED</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input type="text" inputMode="numeric" value={seedVal} placeholder="random"
                          onInput={(e) => setSeedVal((e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''))}
                          disabled={busy} style={{ ...S.select, width: '108px', cursor: 'text' }} />
                        <button type="button" title="Randomize each run" disabled={busy} onClick={() => { setSeedVal(''); setSeedLock(false); }} style={{ ...actBtn, padding: '6px 8px' }}>🎲</button>
                        <button type="button" title="Lock last seed (reproduce)" disabled={busy} onClick={() => setSeedLock((v) => !v)}
                          style={{ ...actBtn, padding: '6px 8px', color: seedLock ? '#06210f' : 'var(--color-text-muted)', background: seedLock ? '#34d39a' : 'var(--color-elevated)', border: '1px solid ' + (seedLock ? '#34d39a' : 'var(--color-border)') }}>{seedLock ? '🔒' : '🔓'}</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Prompt */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={S.label}>PROMPT</div>
                  {promptHist.length > 0 && (
                    <select value="" disabled={busy}
                      onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) setPrompt(v); (e.target as HTMLSelectElement).value = ''; }}
                      style={{ ...S.select, fontSize: '11px', padding: '4px 8px', maxWidth: '260px' }}>
                      <option value="">↩ recent prompts…</option>
                      {promptHist.map((p, i) => <option key={i} value={p}>{p.length > 60 ? p.slice(0, 60) + '…' : p}</option>)}
                    </select>
                  )}
                </div>
                <textarea
                  value={prompt}
                  onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
                  placeholder={
                    imgEngine === 'banana'
                      ? 'A glowing stock chart erupting upward, trading floor atmosphere, Nano Banana Pro…'
                      : 'A neon-lit candlestick chart exploding upward, cinematic…'
                  }
                  rows={4}
                  disabled={busy}
                  style={S.ta}
                />

                {imgEngine === 'comfyui' && (
                  <>
                    <div style={{ marginTop: '10px' }}>
                      <div style={S.label}>NEGATIVE PROMPT</div>
                      <textarea
                        value={comfyNeg}
                        onInput={(e) => setComfyNeg((e.target as HTMLTextAreaElement).value)}
                        rows={2}
                        disabled={busy}
                        style={{ ...S.ta, fontSize: '12px' }}
                      />
                    </div>

                    {/* Per-family "best results" tips — keyed off the base model's family */}
                    {selectedCkpt && (() => {
                      const tips = FAM_TIPS[ckptFam || 'other'] ?? FAM_TIPS.other;
                      const addTag = () => { if (tips.prefix) { const lc = prompt.toLowerCase(); if (!lc.includes('score_9') && !lc.includes(tips.prefix.toLowerCase().slice(0, 10))) setPrompt(p => tips.prefix + ', ' + p); } };
                      const addNeg = () => { if (tips.neg && !comfyNeg.toLowerCase().includes(tips.neg.toLowerCase().slice(0, 8))) setComfyNeg(n => (n.trim() ? n.replace(/\s*$/, '') + ', ' : '') + tips.neg); };
                      return (
                        <div style={{ marginTop: '12px', border: `1px solid ${famInfo(ckptFam).color}`, borderRadius: '8px', padding: '10px 12px', background: 'var(--color-elevated)' }}>
                          <div style={{ ...S.label, marginBottom: '6px', color: famInfo(ckptFam).color }}>{famInfo(ckptFam).emoji} {famInfo(ckptFam).label} — BEST RESULTS</div>
                          <div style={{ fontSize: '11px', lineHeight: '1.55', color: 'var(--color-text-muted)', fontFamily: MONO }}>{tips.note}</div>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO, marginTop: '6px' }}>Suggested · steps {tips.steps} · {tips.size}</div>
                          {(tips.prefix || tips.neg) && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                              {tips.prefix && (
                                <button type="button" disabled={busy} onClick={addTag}
                                  style={{ fontSize: '10px', color: '#34d39a', background: 'none', border: '1px solid rgba(52,211,154,0.3)', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontFamily: MONO }}>
                                  + add quality tags
                                </button>
                              )}
                              {tips.neg && (
                                <button type="button" disabled={busy} onClick={addNeg}
                                  style={{ fontSize: '10px', color: '#ffb347', background: 'none', border: '1px solid rgba(255,179,71,0.3)', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontFamily: MONO }}>
                                  + add to negative
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {comfyModels?.loras?.length ? (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <div style={S.label}>STYLE ADD-ONS · LORAS {comfyLoras.length > 0 && <span style={{ color: '#34d39a' }}>({comfyLoras.length} active)</span>}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO }}>STRENGTH</span>
                            <input
                              type="range" min="0.3" max="1.2" step="0.05"
                              value={comfyLoraStrength}
                              onInput={(e) => setComfyLoraStrength(Number((e.target as HTMLInputElement).value))}
                              disabled={busy}
                              style={{ width: '90px', accentColor: '#34d39a' }}
                            />
                            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: MONO, minWidth: '28px' }}>{comfyLoraStrength.toFixed(2)}</span>
                            <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO }}>higher = stronger</span>
                          </div>
                          {comfyLoras.length > 0 && (
                            <button type="button" onClick={() => setComfyLoras([])} disabled={busy}
                              style={{ fontSize: '10px', color: '#ef5350', background: 'none', border: '1px solid rgba(239,83,80,0.3)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontFamily: MONO }}>
                              clear all
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO, marginBottom: '8px' }}>
                          Layered on the base model — stack as many as you like. Locked 🔒 ones don't match {famInfo(ckptFam).label} and would produce artifacts.
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {comfyModels.loras.map(l => {
                            const active = comfyLoras.includes(l.name);
                            const compatible = loraCompatible(l.family, ckptFam);
                            const fi = famInfo(l.family);
                            if (!compatible) {
                              return (
                                <span key={l.name}
                                  title={`${cleanName(l.name)} — trained for ${fi.label}, not ${famInfo(ckptFam).label}. Pick a ${fi.label} base model to use it.`}
                                  style={{
                                    fontSize: '11px', fontFamily: MONO, padding: '4px 10px', borderRadius: '6px',
                                    cursor: 'not-allowed', color: 'var(--color-text-faint)',
                                    background: 'var(--color-elevated)', border: '1px dashed var(--color-border)', opacity: 0.55,
                                  }}>
                                  🔒 {cleanName(l.name)} · {fi.label}
                                </span>
                              );
                            }
                            return (
                              <button
                                key={l.name}
                                type="button"
                                disabled={busy}
                                onClick={() => setComfyLoras(prev =>
                                  prev.includes(l.name) ? prev.filter(x => x !== l.name) : [...prev, l.name]
                                )}
                                style={{
                                  fontSize: '11px', fontFamily: MONO, padding: '4px 10px',
                                  borderRadius: '6px', cursor: busy ? 'not-allowed' : 'pointer',
                                  color: active ? '#06210f' : 'var(--color-text-muted)',
                                  background: active ? '#34d39a' : 'var(--color-elevated)',
                                  border: '1px solid ' + (active ? '#34d39a' : 'var(--color-border)'),
                                }}
                                title={`${l.name} — ${l.sizeMB}MB${l.baseModel ? ` · Civitai: ${l.baseModel}` : ''}`}
                              >
                                {active ? '✓ ' : ''}{cleanName(l.name)}{l.verified === false ? ' ?' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Trigger words — added to the prompt automatically; tap × to drop one */}
                    {activeTriggers.length > 0 && (
                      <div style={{ marginTop: '12px', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '10px 12px', background: 'var(--color-elevated)' }}>
                        <div style={{ ...S.label, marginBottom: '8px' }}>TRIGGER WORDS — ADDED FOR YOU</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {activeTriggers.map(t => {
                            const dropped = droppedTriggers.includes(t);
                            return (
                              <span key={t} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                fontSize: '11px', fontFamily: MONO, padding: '2px 4px 2px 8px', borderRadius: '6px',
                                color: dropped ? 'var(--color-text-faint)' : '#34d39a',
                                background: 'var(--color-card)',
                                border: '1px solid ' + (dropped ? 'var(--color-border)' : 'rgba(52,211,154,0.3)'),
                                textDecoration: dropped ? 'line-through' : 'none',
                              }}>
                                {t}
                                <button type="button" disabled={busy}
                                  onClick={() => setDroppedTriggers(prev => dropped ? prev.filter(x => x !== t) : [...prev, t])}
                                  title={dropped ? 'add back' : 'remove from prompt'}
                                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: MONO, fontSize: '12px', padding: '0 2px' }}>
                                  {dropped ? '+' : '×'}
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '16px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => genImage()} disabled={!canImg} style={genBtnStyle(canImg)}>
                    {busy
                      ? <><span class="cc-spin">⟳</span> {batchCount > 1 ? `Generating ${batchCount}…` : 'Generating'} {fmtMs(elapsedMs)}</>
                      : (batchCount > 1 ? `✦ Generate ${batchCount}×` : '✦ Generate')}
                  </button>
                  {!busy && lastMs !== null && (result?.ok || batchResults.some(r => r.ok)) && (
                    <span style={{ fontSize: '12px', color: '#34d39a', fontFamily: MONO }}>✓ Generated in {fmtMs(lastMs)}</span>
                  )}
                  {!busy && lastMs === null && imgEngine === 'local' && (
                    <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO }}>free · needs GPU VRAM (close BlueStacks/WSA)</span>
                  )}
                  {!busy && lastMs === null && imgEngine === 'comfyui' && (
                    <span style={{ fontSize: '11px', color: '#34d39a', fontFamily: MONO }}>
                      free · GPU · {comfyCheckpoint ? comfyCheckpoint.replace(/\.(safetensors|ckpt|gguf)$/, '') : 'ComfyUI'}{comfyLoras.length ? ` + ${comfyLoras.length} LoRA${comfyLoras.length > 1 ? 's' : ''}` : ''}
                    </span>
                  )}
                </div>
                {busy && <ProgressBar pct={imgPct} label={imgBarLabel} sub={`${fmtMs(elapsedMs)} elapsed`} />}
              </div>
              </>
              )}

              {/* ── Results (shared by Simple + Advanced) ──────────────────────── */}
              {batchResults.length > 0 && <BatchGrid results={batchResults} />}
              {result && batchResults.length === 0 && (
                <ResultBox result={result} kind="image" prompt={prompt}
                  onRegenerate={() => genImage()}
                  onNewSeed={() => genImage({ seed: undefined })}
                  onSendToVideo={() => { setVidPrompt(prompt); setTab('video'); try { history.replaceState(null, '', '#video'); } catch {} }}
                />
              )}
            </>
          ) : (
            /* ── Video tab ───────────────────────────────────────────────────── */
            <>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
                <div>
                  <div style={S.label}>ENGINE</div>
                  <select value={vidEngine} onChange={(e) => setVidEngine((e.target as HTMLSelectElement).value as 'local' | 'fvm')} style={{ ...S.select, minWidth: '300px' }}>
                    <option value="local">Local — LTX-Video (free, on-GPU)</option>
                    <option value="fvm">Free Video Maker (Veo / Sora / Replicate / fal · paid)</option>
                  </select>
                </div>
              </div>

              {vidEngine === 'local' ? (
                <>
                  <div style={S.card}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={S.label}>PROMPT</div>
                      {promptHist.length > 0 && (
                        <select value="" disabled={vidBusy}
                          onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) setVidPrompt(v); (e.target as HTMLSelectElement).value = ''; }}
                          style={{ ...S.select, fontSize: '11px', padding: '4px 8px', maxWidth: '260px' }}>
                          <option value="">↩ recent prompts…</option>
                          {promptHist.map((p, i) => <option key={i} value={p}>{p.length > 60 ? p.slice(0, 60) + '…' : p}</option>)}
                        </select>
                      )}
                    </div>
                    <textarea value={vidPrompt} onInput={(e) => setVidPrompt((e.target as HTMLTextAreaElement).value)} placeholder="A golden bull charging through a glowing stock chart, cinematic, smooth motion" rows={4} disabled={vidBusy} style={S.ta} />
                    <div style={{ marginTop: '10px' }}>
                      <div style={S.label}>SEED</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input type="text" inputMode="numeric" value={vidSeedVal} placeholder="random"
                          onInput={(e) => setVidSeedVal((e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''))}
                          disabled={vidBusy} style={{ ...S.select, width: '108px', cursor: 'text' }} />
                        <button type="button" title="Randomize each run" disabled={vidBusy} onClick={() => { setVidSeedVal(''); setVidSeedLock(false); }} style={{ ...actBtn, padding: '6px 8px' }}>🎲</button>
                        <button type="button" title="Lock last seed (reproduce)" disabled={vidBusy} onClick={() => setVidSeedLock((v) => !v)}
                          style={{ ...actBtn, padding: '6px 8px', color: vidSeedLock ? '#06210f' : 'var(--color-text-muted)', background: vidSeedLock ? '#34d39a' : 'var(--color-elevated)', border: '1px solid ' + (vidSeedLock ? '#34d39a' : 'var(--color-border)') }}>{vidSeedLock ? '🔒' : '🔓'}</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '16px' }}>
                      <button type="button" onClick={() => genVideo()} disabled={!canVid} style={genBtnStyle(canVid)}>{vidBusy ? <><span class="cc-spin">⟳</span> Rendering {fmtMs(vidElapsedMs)}</> : '✦ Generate Video'}</button>
                      {!vidBusy && vidLastMs !== null && vidResult?.ok
                        ? <span style={{ fontSize: '12px', color: '#34d39a', fontFamily: MONO }}>✓ Rendered in {fmtMs(vidLastMs)}</span>
                        : <span style={{ fontSize: '12px', color: 'var(--color-text-faint)', fontFamily: MONO }}>
                            {vidBusy ? 'Rendering on the GPU — a few minutes (model loads first).' : 'Free, on-GPU. Needs free VRAM (close BlueStacks/WSA if it errors).'}
                          </span>}
                    </div>
                    {vidBusy && <ProgressBar pct={vidProgress} label="Rendering video on the GPU…" sub={`${fmtMs(vidElapsedMs)} elapsed`} />}
                  </div>
                  {vidResult && (
                    <ResultBox result={vidResult} kind="video" prompt={vidPrompt}
                      onRegenerate={() => genVideo()}
                      onNewSeed={() => genVideo({ seed: undefined })}
                    />
                  )}
                </>
              ) : (
                <>
                  <p style={{ fontSize: '12px', color: 'var(--color-text-faint)', fontFamily: MONO, margin: '0 0 12px' }}>
                    Finished renders save to the <a href="/gallery" style={{ color: '#7fd1ff' }}>Gallery</a> automatically.{' '}
                    <a href={VIDEO_URL} target="_blank" rel="noreferrer" style={{ color: '#7fd1ff' }}>↗ open in a new tab</a>
                  </p>
                  <iframe src={VIDEO_URL} title="Free Video Maker" style={{ width: '100%', height: '78vh', border: '1px solid var(--color-border)', borderRadius: '10px', background: 'var(--color-bg)' }} />
                </>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
