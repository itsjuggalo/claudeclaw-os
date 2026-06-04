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
type ComfyModels = { checkpoints: {name:string;sizeGB:number}[]; loras: {name:string;sizeMB:number}[] };
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
// ── ComfyUI prompt guide ──────────────────────────────────────────────────────
const COMFY_GUIDE: Record<string, { prefix: string; tip: string; type: 'pony' | 'sdxl' | 'sd15' }> = {
  cyberrealisticPony_v170:        { type: 'pony',  prefix: 'score_9, score_8_up, score_7_up, score_6_up',       tip: 'Pony base — quality tags REQUIRED or output looks washed out. Pairs best with Pony-only LoRAs (Big Eyes, Cow Hybrid, Starbucks Girl).' },
  epicellaXL_photoV1:             { type: 'sdxl',  prefix: 'photo of, RAW photo, 8k uhd, realistic, detailed',  tip: 'SDXL — female portraits and lifestyle photography. Add a subject description after the prefix, e.g. "beautiful woman, outdoor".' },
  epicphotogasm_ultimateFidelity: { type: 'sd15',  prefix: 'photograph, professional photo, 8k, detailed skin', tip: 'SD1.5 — extreme face/skin detail. Best for close-up beauty and portrait shots. Use WITHOUT LoRAs for cleanest results.' },
  epicrealismXL_pureFix:          { type: 'sdxl',  prefix: 'RAW photo, realistic, photorealistic, 8k uhd',      tip: 'SDXL all-rounder — most versatile, works with all SDXL LoRAs. Good default when unsure which checkpoint to pick.' },
};
// ── Checkpoint descriptive labels for dropdown ────────────────────────────────
const COMFY_CHECKPOINT_DESC: Record<string, string> = {
  'cyberrealisticPony_v170.safetensors':        'CyberRealistic Pony — semi-realistic humans, animal hybrids, Pony LoRAs',
  'epicellaXL_photoV1.safetensors':             'EpicElla XL — female portraits, lifestyle, natural skin tone',
  'epicphotogasm_ultimateFidelity.safetensors': 'EpicPhotogasm (SD1.5) — extreme skin/face detail, portrait close-ups, use without LoRAs',
  'epicrealismXL_pureFix.safetensors':          'EpicRealism XL — versatile all-subjects, best base for SDXL LoRAs',
};
const COMFY_LORA_GUIDE: Record<string, { trigger: string | null; tip: string; compat: 'pony' | 'sdxl' | 'any' | 'sd15' }> = {
  'Callie Cowgirl':                                        { trigger: 'callie',       compat: 'any',  tip: 'Character — redhead cowgirl. Trigger "callie" required. Works with Pony + SDXL.' },
  'RLY-thot_shot-ZiB-ZiT-helena-v1-trigger-rlyhelena':   { trigger: 'rlyhelena',    compat: 'any',  tip: 'Character — specific person style. Trigger "rlyhelena" required. Works with Pony + SDXL.' },
  'RealFeet_xl_v1':                                       { trigger: 'feet',         compat: 'sdxl', tip: 'SDXL only — foot realism enhancer. Trigger "feet" required. Use with epicrealismXL or epicellaXL.' },
  'RealSkin_xxXL_v1':                                     { trigger: null,           compat: 'sdxl', tip: 'SDXL only — boosts skin texture and pores automatically. Stack with any SDXL checkpoint.' },
  'bigeyes-ponyxl-v1':                                    { trigger: null,           compat: 'pony', tip: 'Pony only — adds big anime-style eyes. Will degrade output on SDXL checkpoints.' },
  'cow-ponyxl-v1':                                        { trigger: 'c0wg1rl',      compat: 'pony', tip: 'Pony only — animal/cow hybrid features. Trigger "c0wg1rl" required. Use with cyberrealisticPony.' },
  'feet_forward-EpicUni-V1':                              { trigger: 'feet forward', compat: 'sd15', tip: '⚠ SD1.5 LoRA — poses feet toward camera. Trigger "feet forward" (close-up) or "foot focus" (wider).' },
  'kFeetMix101_v2-000006':                                { trigger: 'feet101',      compat: 'sd15', tip: '⚠ SD1.5 model — may produce artifacts on SDXL/Pony. Classic foot detail LoRA, trigger "feet101" required.' },
  'starbucksgirl_Pony':                                   { trigger: 'sbgirl',       compat: 'pony', tip: 'Pony only — Starbucks barista aesthetic. Trigger "sbgirl" required. Use with cyberrealisticPony.' },
  'zy_AmateurStyle_v2':                                   { trigger: null,           compat: 'any',  tip: 'Any base — candid/unfiltered amateur phone-photo aesthetic. No trigger, stacks well with character LoRAs.' },
};
// ── LoRA short display labels for toggle buttons ──────────────────────────────
const COMFY_LORA_SHORT: Record<string, string> = {
  'Callie Cowgirl.safetensors':                                       'Callie Cowgirl [character]',
  'RLY-thot_shot-ZiB-ZiT-helena-v1-trigger-rlyhelena.safetensors':   'Helena [character]',
  'RealFeet_xl_v1.safetensors':                                       'RealFeet XL [SDXL]',
  'RealSkin_xxXL_v1.safetensors':                                     'RealSkin [SDXL]',
  'bigeyes-ponyxl-v1.safetensors':                                    'Big Eyes [Pony only]',
  'cow-ponyxl-v1.safetensors':                                        'Cow Hybrid [Pony only]',
  'feet_forward-EpicUni-V1.safetensors':                              'Feet Forward Pose [SDXL]',
  'kFeetMix101_v2-000006.safetensors':                                'K-Feet Mix [⚠ SD1.5]',
  'starbucksgirl_Pony.safetensors':                                   'Starbucks Girl [Pony only]',
  'zy_AmateurStyle_v2.safetensors':                                   'Amateur Style [any]',
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

// ── ComfyUI full-screen guide modal ──────────────────────────────────────────
function GuideModal({ onClose }: { onClose: () => void }) {
  const QUICK_PICKS = [
    { name: 'CyberRealistic Pony', badge: 'PONY', badgeColor: '#ffb347', bg: 'rgba(255,179,71,0.08)', border: 'rgba(255,179,71,0.25)', desc: 'Semi-realistic humans, anime-adjacent, animal hybrids', best: 'Pony LoRAs only' },
    { name: 'EpicElla XL',         badge: 'SDXL', badgeColor: '#7fd1ff', bg: 'rgba(127,209,255,0.06)', border: 'rgba(127,209,255,0.2)', desc: 'Female portraits, lifestyle, natural lighting', best: 'SDXL LoRAs' },
    { name: 'EpicRealism XL',      badge: 'SDXL', badgeColor: '#7fd1ff', bg: 'rgba(127,209,255,0.06)', border: 'rgba(127,209,255,0.2)', desc: 'Anything realistic — most versatile, best default', best: 'SDXL LoRAs' },
    { name: 'EpicPhotogasm',       badge: 'SD1.5', badgeColor: '#ef5350', bg: 'rgba(239,83,80,0.06)',  border: 'rgba(239,83,80,0.2)',  desc: 'Extreme face/skin close-ups, beauty detail', best: 'No LoRAs' },
  ];
  const LORA_GROUPS = [
    { group: 'PONY ONLY', color: '#ffb347', loras: [
      { name: 'Big Eyes',        trigger: null,        tip: 'Anime-style large eyes — degrades on SDXL' },
      { name: 'Cow Hybrid',      trigger: 'c0wg1rl',   tip: 'Animal/cow features. Use with CyberRealistic Pony' },
      { name: 'Starbucks Girl',  trigger: 'sbgirl',    tip: 'Barista aesthetic, add "coffee shop"' },
    ]},
    { group: 'SDXL ONLY', color: '#7fd1ff', loras: [
      { name: 'RealFeet XL',         trigger: 'feet',         tip: 'Foot realism — EpicRealism or EpicElla' },
      { name: 'RealSkin',            trigger: null,           tip: 'Skin texture auto-boost, no trigger needed' },
      { name: 'Feet Forward Pose',   trigger: 'feet forward', tip: '⚠ Actually SD1.5 base — use carefully on SDXL' },
    ]},
    { group: 'ANY BASE', color: 'var(--color-text-muted)', loras: [
      { name: 'Callie Cowgirl', trigger: 'callie',    tip: 'Redhead cowgirl character — works everywhere' },
      { name: 'Helena',         trigger: 'rlyhelena', tip: 'Specific person style — works everywhere' },
      { name: 'Amateur Style',  trigger: null,        tip: 'Candid phone-photo aesthetic, no trigger' },
    ]},
    { group: 'SD1.5 LEGACY', color: '#ef5350', loras: [
      { name: 'K-Feet Mix 101',       trigger: 'feet101',      tip: '⚠ SD1.5 — artifacts on SDXL/Pony, use alone' },
      { name: 'Feet Forward EpicUni', trigger: 'feet forward', tip: '⚠ SD1.5 — best without mixing other LoRAs' },
    ]},
  ];
  const RECIPES = [
    { name: 'Cowgirl',                  checkpoint: 'CyberRealistic Pony', loras: 'Callie Cowgirl + Cow Hybrid', prompt: 'c0wg1rl, callie, 1girl' },
    { name: 'Starbucks Barista',        checkpoint: 'CyberRealistic Pony', loras: 'Starbucks Girl + Big Eyes',   prompt: 'sbgirl, 1girl, coffee shop' },
    { name: 'Realistic Portrait + Feet',checkpoint: 'EpicRealism XL',      loras: 'RealFeet XL + RealSkin',      prompt: 'feet, barefoot, 1girl' },
    { name: 'Close-up Face',            checkpoint: 'EpicPhotogasm',        loras: 'none',                        prompt: 'photograph, close-up, face' },
  ];
  const codeChip = (text: string) => (
    <code style={{ fontSize: '11px', color: '#34d39a', background: 'var(--color-elevated)', border: '1px solid var(--color-border-strong)', borderRadius: '4px', padding: '1px 6px', fontFamily: MONO }}>{text}</code>
  );
  const sectionHdr = (n: string) => (
    <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', letterSpacing: '1.5px', marginBottom: '12px', fontFamily: MONO }}>{n}</div>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px 16px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '12px', width: '100%', maxWidth: '680px', padding: '24px', fontFamily: MONO }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', color: '#34d39a', letterSpacing: '2px' }}>COMFYUI GUIDE</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: '14px' }}>×</button>
        </div>

        <div style={{ marginBottom: '24px' }}>
          {sectionHdr('1 — QUICK PICK')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
            {QUICK_PICKS.map(c => (
              <div key={c.name} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text)', fontWeight: 700, fontFamily: MONO }}>{c.name}</span>
                  <span style={{ fontSize: '9px', color: c.badgeColor, border: `1px solid ${c.badgeColor}`, borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap', marginLeft: '6px', flexShrink: 0 }}>{c.badge}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '6px', lineHeight: '1.4', fontFamily: MONO }}>{c.desc}</div>
                <div style={{ fontSize: '10px', color: c.badgeColor, fontFamily: MONO }}>Best for: {c.best}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          {sectionHdr('2 — LORA COMPATIBILITY MATRIX')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {LORA_GROUPS.map(g => (
              <div key={g.group}>
                <div style={{ fontSize: '10px', color: g.color, letterSpacing: '1px', marginBottom: '6px', fontFamily: MONO }}>— {g.group}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {g.loras.map(l => (
                    <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', minWidth: '150px', fontFamily: MONO }}>{l.name}</span>
                      {l.trigger ? codeChip(l.trigger) : <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic', fontFamily: MONO }}>auto</span>}
                      <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: MONO }}>{l.tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          {sectionHdr('3 — EXAMPLE RECIPES')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {RECIPES.map(r => (
              <div key={r.name} style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ fontSize: '11px', color: '#34d39a', marginBottom: '4px', fontFamily: MONO }}>{r.name}</div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: MONO, marginBottom: '5px' }}>
                  <span style={{ color: 'var(--color-text-faint)' }}>Checkpoint:</span> {r.checkpoint} &nbsp;·&nbsp;
                  <span style={{ color: 'var(--color-text-faint)' }}>LoRAs:</span> {r.loras}
                </div>
                {codeChip(r.prompt)}
              </div>
            ))}
          </div>
        </div>

        <div>
          {sectionHdr('4 — NEGATIVE PROMPT DEFAULTS')}
          <div style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '12px' }}>
            {codeChip('deformed, ugly, blurry, low quality, bad anatomy, watermark, text')}
            <div style={{ marginTop: '10px', fontSize: '10px', color: '#ffb347', fontFamily: MONO }}>
              ⚠ Pony models: also add{' '}
              <code style={{ color: '#ffb347', background: 'rgba(255,179,71,0.1)', border: '1px solid rgba(255,179,71,0.25)', borderRadius: '3px', padding: '1px 5px', fontFamily: MONO }}>score_4, score_5, score_6</code>
              {' '}to negatives for best results.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ComfyUI prompt guide component ───────────────────────────────────────────
function ComfyPromptGuide({ checkpoint, loras, onInject }: { checkpoint: string; loras: string[]; onInject: (s: string) => void }) {
  const key = checkpoint.replace(/\.(safetensors|ckpt|gguf)$/, '');
  const guide = COMFY_GUIDE[key];
  const activeGuides = loras.map(l => ({ name: l.replace(/\.safetensors$/, ''), info: COMFY_LORA_GUIDE[l.replace(/\.safetensors$/, '')] })).filter(x => x.info);
  if (!guide && !activeGuides.length) return null;
  const pony = guide?.type === 'pony';
  const sd15cp = guide?.type === 'sd15';
  const typeLabel = pony ? 'PONY' : sd15cp ? 'SD1.5' : 'SDXL';
  const typeColor = pony ? '#ffb347' : sd15cp ? '#ef5350' : '#7fd1ff';
  const mismatched = guide ? activeGuides.filter(({ info }) => {
    const c = info.compat;
    if (guide.type === 'sd15') return c !== 'any' && c !== 'sd15';
    return (guide.type === 'pony' && c === 'sdxl') || (guide.type === 'sdxl' && c === 'pony') || c === 'sd15';
  }) : [];
  return (
    <div style={{ marginTop: '12px', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px 14px', background: 'var(--color-elevated)' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', letterSpacing: '1.5px', fontFamily: MONO, marginBottom: '8px' }}>PROMPT GUIDE</div>
      {guide && (
        <div style={{ marginBottom: activeGuides.length ? '10px' : 0 }}>
          <div style={{ fontSize: '11px', color: typeColor, fontFamily: MONO, marginBottom: '5px' }}>
            {typeLabel} — {guide.tip}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <code style={{ fontSize: '12px', color: 'var(--color-text)', background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: '4px', padding: '4px 8px', fontFamily: MONO }}>{guide.prefix}</code>
            <button type="button" onClick={() => onInject(guide.prefix + ', ')}
              style={{ fontSize: '10px', color: '#34d39a', background: 'none', border: '1px solid rgba(52,211,154,0.3)', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontFamily: MONO }}>
              + prepend
            </button>
          </div>
        </div>
      )}
      {mismatched.length > 0 && (
        <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(255,179,71,0.08)', border: '1px solid rgba(255,179,71,0.25)', borderRadius: '6px' }}>
          <span style={{ fontSize: '11px', color: '#ffb347', fontFamily: MONO }}>
            ⚠ Compatibility: {mismatched.map(m => m.name).join(', ')} {mismatched.length === 1 ? 'is' : 'are'} not designed for {pony ? 'Pony' : sd15cp ? 'SD1.5' : 'SDXL'} — may produce artifacts
          </span>
        </div>
      )}
      {activeGuides.length > 0 && (
        <div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', letterSpacing: '1px', fontFamily: MONO, marginBottom: '6px' }}>ACTIVE LORA TRIGGERS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeGuides.map(({ name, info }) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: info.compat === 'pony' ? '#ffb347' : info.compat === 'sd15' ? '#ef5350' : info.compat === 'sdxl' ? '#7fd1ff' : 'var(--color-text-muted)', fontFamily: MONO, minWidth: '0', flex: '0 0 auto', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info.tip}>{name}</span>
                {info.trigger
                  ? <><code style={{ fontSize: '12px', color: '#34d39a', background: 'var(--color-card)', border: '1px solid var(--color-border-strong)', borderRadius: '4px', padding: '2px 7px', fontFamily: MONO }}>{info.trigger}</code>
                      <button type="button" onClick={() => onInject(info.trigger! + ', ')}
                        style={{ fontSize: '10px', color: '#34d39a', background: 'none', border: '1px solid rgba(52,211,154,0.3)', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer', fontFamily: MONO }}>+ add</button></>
                  : <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: MONO, fontStyle: 'italic' }}>{info.tip}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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

  // banana state
  const [prompt, setPrompt] = useState('');
  const [bnModel, setBnModel] = useState(() => loadPref('bnModel', 'flash'));
  const [bnAspect, setBnAspect] = useState(() => loadPref('bnAspect', '1:1'));
  const [bnSize, setBnSize] = useState(() => loadPref('bnSize', '2K'));

  // local state
  const [localModel, setLocalModel] = useState(() => loadPref('localModel', 'sdxl-turbo'));

  // comfyui state
  const [showGuide, setShowGuide] = useState(false);
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
  useEffect(() => { savePref('bnModel', bnModel); }, [bnModel]);
  useEffect(() => { savePref('bnAspect', bnAspect); }, [bnAspect]);
  useEffect(() => { savePref('bnSize', bnSize); }, [bnSize]);
  useEffect(() => { savePref('localModel', localModel); }, [localModel]);
  useEffect(() => { savePref('comfySize', comfySize); }, [comfySize]);
  useEffect(() => { savePref('comfySteps', comfySteps); }, [comfySteps]);
  useEffect(() => { savePref('comfyLoraStrength', comfyLoraStrength); }, [comfyLoraStrength]);

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
  const vidStartRef = useRef(0);

  const bnSizeOpts = bnModel === 'pro' ? BANANA_SIZES.filter((s) => s !== '512') : BANANA_SIZES;
  const canImg = prompt.trim().length > 0 && !busy;
  const canVid = vidPrompt.trim().length > 0 && !vidBusy;

  // ── Clear results when switching engine or tab ────────────────────────────
  useEffect(() => { setResult(null); setBatchResults([]); setLastMs(null); }, [tab, imgEngine]);

  function applyBananaPreset(model: string) {
    setImgEngine('banana');
    setBnModel(model);
  }

  // ── Max batch counts per engine
  const maxBatch = imgEngine === 'banana' ? 5 : imgEngine === 'comfyui' ? 1 : 3;

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
        r = await apiPost<GenResult>('/api/comfy/generate', {
          prompt: prompt.trim(), negative_prompt: comfyNeg, steps: comfySteps,
          width: w, height: h,
          checkpoint: comfyCheckpoint || undefined,
          loras: comfyLoras.length ? comfyLoras.map(name => ({ name, strength: comfyLoraStrength })) : undefined,
          ...(seedNum !== undefined ? { seed: seedNum } : {}),
        });
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
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: tab === 'video' && vidEngine === 'fvm' ? '1200px' : '900px', margin: '0 auto' }}>

          {tab === 'image' ? (
            <>
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
                      <option value="comfyui">ComfyUI — CyberRealistic Pony (free, on-GPU, best quality)</option>
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
                          <div style={{ ...S.label, marginBottom: 0 }}>CHECKPOINT</div>
                          <button type="button" onClick={() => setShowGuide(true)}
                            style={{ fontSize: '10px', fontFamily: MONO, letterSpacing: '1px', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', color: '#34d39a', background: 'none', border: '1px solid rgba(52,211,154,0.3)' }}>
                            ? Guide
                          </button>
                        </div>
                        <select value={comfyCheckpoint} onChange={(e) => setComfyCheckpoint((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...S.select, minWidth: '280px' }}>
                          {comfyModels?.checkpoints?.length
                            ? comfyModels.checkpoints.map(c => (
                                <option key={c.name} value={c.name}>{COMFY_CHECKPOINT_DESC[c.name] ?? c.name.replace(/\.(safetensors|ckpt|gguf)$/, '')} ({c.sizeGB}GB)</option>
                              ))
                            : <option value="">Loading…</option>}
                        </select>
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
                    {comfyModels?.loras?.length ? (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px', flexWrap: 'wrap' }}>
                          <div style={S.label}>LORAS {comfyLoras.length > 0 && <span style={{ color: '#34d39a' }}>({comfyLoras.length} active)</span>}</div>
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
                          </div>
                          {comfyLoras.length > 0 && (
                            <button type="button" onClick={() => setComfyLoras([])} disabled={busy}
                              style={{ fontSize: '10px', color: '#ef5350', background: 'none', border: '1px solid rgba(239,83,80,0.3)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontFamily: MONO }}>
                              clear all
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {comfyModels.loras.map(l => {
                            const active = comfyLoras.includes(l.name);
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
                                title={`${l.name} — ${l.sizeMB}MB`}
                              >
                                {COMFY_LORA_SHORT[l.name] ?? l.name.replace(/\.safetensors$/, '')}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <ComfyPromptGuide checkpoint={comfyCheckpoint} loras={comfyLoras} onInject={(s) => setPrompt(prev => s + prev)} />
                    {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
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

              {/* ── Results ───────────────────────────────────────────────────── */}
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
