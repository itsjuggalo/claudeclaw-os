// Photo Studio — the interactive generator at the top of the Media & Gens
// (Gallery) view. Two modes, auto-detected:
//   • a photo is attached → EDIT it via Nano Banana Pro (img2img: keeps the
//     subject, applies the transform — "make me half-wolf / bionic / film-noir").
//   • text only          → CREATE via the chosen engine (Local LoRAs or Nano Banana).
// Results save into the gallery "Generated" section, so onDone() refreshes the
// grid and the new image appears below. Works from a phone (web file upload +
// camera), which the CLI can't do.
import { useState, useRef } from 'preact/hooks';
import { dashboardToken, apiPost, apiPostForm } from '@/lib/api';

interface GenResult { ok: boolean; file?: string; url?: string; notes?: string; error?: string; }

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const ACCENT = '#f59e0b';        // matches the "nano/gen" gallery section accent

const withTok = (u: string) =>
  dashboardToken ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}` : u;

// One-tap look presets. EDIT presets address "the person"; CREATE presets are
// standalone scene prompts. Tapping fills the prompt box (still editable).
const EDIT_LOOKS: { label: string; prompt: string }[] = [
  { label: '🐺 Half-wolf', prompt: 'Transform the person into a half-wolf werewolf hybrid — keep their face recognizable but add wolf ears, glowing amber eyes, fur along the jaw and neck, a subtle snout, fierce cinematic lighting.' },
  { label: '🤖 Bionic', prompt: 'Turn the person into a bionic cyborg — chrome mechanical jaw and cheek panels, one glowing blue cybernetic eye, exposed circuitry under the skin, carbon-fiber neck, sci-fi rim lighting. Keep their likeness.' },
  { label: '⚡ Cyberpunk', prompt: 'Apply a cyberpunk filter — neon magenta and cyan rim lighting, rain-soaked night-city bokeh behind them, holographic reflections. Keep the face natural.' },
  { label: '🎞️ Film noir', prompt: 'Black-and-white film-noir filter — dramatic high-contrast chiaroscuro lighting, deep shadows, 1940s cinematic grain. Keep the composition.' },
  { label: '🎨 Oil painting', prompt: 'Repaint as a classical oil painting — visible brushstrokes, rich impasto texture, warm gallery light, Rembrandt style. Keep the likeness.' },
  { label: '🗿 Marble', prompt: 'Transform into a polished white marble statue — carved stone texture, museum pedestal, soft directional lighting.' },
];
const CREATE_LOOKS: { label: string; prompt: string }[] = [
  { label: '🐺 Wolf warrior', prompt: 'A fierce half-wolf warrior portrait, glowing amber eyes, fur and battle armor, dramatic cinematic lighting, ultra-detailed.' },
  { label: '🤖 Cyborg', prompt: 'A bionic cyborg portrait, chrome plating, glowing blue eye, exposed circuitry, carbon fiber, sci-fi studio lighting.' },
  { label: '⚡ Neon city', prompt: 'A rain-soaked cyberpunk city street at night, neon magenta and cyan signs, reflections on wet asphalt, cinematic.' },
  { label: '🎨 Oil portrait', prompt: 'A classical oil-painting portrait, rich impasto brushstrokes, warm gallery lighting, Rembrandt style.' },
];

export function PhotoStudio({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState<'local' | 'banana'>('local'); // CREATE-mode engine
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isEdit = !!file;
  const looks = isEdit ? EDIT_LOOKS : CREATE_LOOKS;

  function pickFile(f: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setResult(null);
    setErr('');
    setPreview(f ? URL.createObjectURL(f) : '');
  }

  function onFileInput(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0] || null;
    if (f && !f.type.startsWith('image/')) { setErr('Pick an image file (JPG, PNG, or WebP).'); return; }
    pickFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0] || null;
    if (f && !f.type.startsWith('image/')) { setErr('Drop an image file (JPG, PNG, or WebP).'); return; }
    if (f) pickFile(f);
  }

  async function run() {
    const p = prompt.trim();
    if (!p) { setErr(isEdit ? 'Tell it what to do to the photo.' : 'Describe the image to create.'); return; }
    setBusy(true); setErr(''); setResult(null);
    try {
      let r: GenResult;
      if (isEdit && file) {
        const fd = new FormData();
        fd.append('photo', file);
        fd.append('prompt', p);
        fd.append('model', 'pro');     // Nano Banana Pro holds likeness best
        r = await apiPostForm<GenResult>('/api/gallery/edit', fd);
      } else {
        r = await apiPost<GenResult>('/api/gallery/generate', {
          prompt: p,
          source: engine,
          ...(engine === 'banana' ? { model: 'pro' } : {}),
        });
      }
      setResult(r);
      if (!r.ok) setErr(r.error || 'Generation failed.');
      else onDone();              // refresh the gallery so the new file shows below
    } catch (e: unknown) {
      const body = (e as { body?: { error?: string } })?.body;
      setErr(body?.error || (e as Error)?.message || 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  const btnLabel = busy
    ? (isEdit ? 'Transforming…' : 'Creating…')
    : (isEdit ? '✨ Transform photo' : '✨ Create image');
  const engineHint = isEdit
    ? 'Edit mode · Nano Banana Pro'
    : (engine === 'local' ? 'Create mode · Local LoRAs (free)' : 'Create mode · Nano Banana');

  return (
    <div style={{ padding: '14px 16px 0', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(180deg, rgba(245,158,11,0.08), rgba(20,27,38,0.6))',
        border: `1px solid ${ACCENT}40`, borderRadius: '14px', overflow: 'hidden',
      }}>
        {/* Header / toggle */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
            padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#e8eaed', fontFamily: MONO, fontWeight: 700, fontSize: '13px',
          }}
        >
          <span style={{ fontSize: '18px' }}>🎨</span>
          <span>Photo Studio</span>
          <span style={{ fontSize: '11px', color: ACCENT, fontWeight: 600 }}>upload a pic → edit · or describe → create</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '14px', color: '#8a97a8' }}>{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Drop / upload zone */}
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={onDrop}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer',
                padding: '14px', borderRadius: '12px',
                border: `1px dashed ${file ? ACCENT : 'rgba(255,255,255,0.18)'}`,
                background: 'rgba(0,0,0,0.25)',
              }}
            >
              {preview ? (
                <img src={preview} alt="selected" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '64px', height: '64px', borderRadius: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', fontSize: '26px' }}>📷</div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#e8eaed', fontSize: '13px', fontWeight: 600 }}>
                  {file ? (file.name || 'photo attached') : 'Tap to add a photo (or drag one in)'}
                </div>
                <div style={{ color: '#8a97a8', fontSize: '11px', fontFamily: MONO, marginTop: '3px' }}>
                  {file ? 'Editing this photo — keeps you, applies the look' : 'No photo = create a brand-new image from text'}
                </div>
              </div>
              {file && (
                <button
                  type="button"
                  onClick={(e: MouseEvent) => { e.stopPropagation(); pickFile(null); if (inputRef.current) inputRef.current.value = ''; }}
                  style={{ marginLeft: 'auto', flexShrink: 0, background: 'rgba(239,68,68,0.15)', color: '#ef8a8a', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontFamily: MONO }}
                >✕ remove</button>
              )}
              <input ref={inputRef} type="file" accept="image/*" onChange={onFileInput} style={{ display: 'none' }} />
            </div>

            {/* Look presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {looks.map(l => (
                <button
                  key={l.label}
                  type="button"
                  onClick={() => { setPrompt(l.prompt); setErr(''); }}
                  style={{
                    padding: '5px 10px', borderRadius: '999px', cursor: 'pointer',
                    fontSize: '11px', fontFamily: MONO, fontWeight: 600,
                    background: 'rgba(245,158,11,0.12)', color: '#f5c97a',
                    border: `1px solid ${ACCENT}40`,
                  }}
                >{l.label}</button>
              ))}
            </div>

            {/* Prompt */}
            <textarea
              value={prompt}
              onInput={(e: Event) => setPrompt((e.currentTarget as HTMLTextAreaElement).value)}
              placeholder={isEdit ? 'What should I do to this photo? e.g. "make me half-wolf, glowing amber eyes, fur on the neck"' : 'Describe the image to create…'}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                padding: '10px 12px', borderRadius: '10px', background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.12)', color: '#e8eaed',
                fontSize: '13px', fontFamily: 'inherit', lineHeight: 1.4, outline: 'none',
              }}
            />

            {/* Engine row + action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {!isEdit && (
                <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.3)', borderRadius: '999px', padding: '3px' }}>
                  {(['local', 'banana'] as const).map(en => (
                    <button
                      key={en}
                      type="button"
                      onClick={() => setEngine(en)}
                      style={{
                        padding: '4px 12px', borderRadius: '999px', cursor: 'pointer', border: 'none',
                        fontSize: '11px', fontFamily: MONO, fontWeight: 700,
                        background: engine === en ? ACCENT : 'transparent',
                        color: engine === en ? '#000' : '#8a97a8',
                      }}
                    >{en === 'local' ? 'Local LoRAs' : 'Nano Banana'}</button>
                  ))}
                </div>
              )}
              <span style={{ fontSize: '11px', color: '#8a97a8', fontFamily: MONO }}>{engineHint}</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={run}
                disabled={busy}
                style={{
                  padding: '9px 18px', borderRadius: '10px', border: 'none',
                  cursor: busy ? 'wait' : 'pointer', fontSize: '13px', fontWeight: 700, fontFamily: MONO,
                  background: busy ? 'rgba(245,158,11,0.4)' : ACCENT, color: '#000',
                }}
              >{btnLabel}</button>
            </div>

            {busy && (
              <div style={{ fontSize: '11px', color: '#8a97a8', fontFamily: MONO }}>
                {isEdit ? 'Nano Banana Pro is transforming your photo — usually 1–3 min. Keep this tab open.' : 'Generating — local gens can take 30–120s on a busy box.'}
              </div>
            )}
            {err && (
              <div style={{ fontSize: '12px', color: '#ef8a8a', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '8px 12px' }}>{err}</div>
            )}
            {result?.ok && result.url && (
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', background: 'rgba(52,211,154,0.06)', border: '1px solid rgba(52,211,154,0.25)', borderRadius: '12px', padding: '12px' }}>
                <img src={withTok(result.url)} alt="result" style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#34d39a', fontSize: '13px', fontWeight: 700 }}>✓ Saved to your gallery</div>
                  <div style={{ color: '#8a97a8', fontSize: '11px', fontFamily: MONO, marginTop: '3px', wordBreak: 'break-all' }}>{result.file}</div>
                  {result.notes && <div style={{ color: '#aab4c0', fontSize: '11px', marginTop: '6px', lineHeight: 1.4 }}>{result.notes}</div>}
                  <a href={withTok(result.url)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '8px', fontSize: '11px', color: '#7fd1ff', fontFamily: MONO }}>open full size ↗</a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
