// Create — generate media into the Gallery.
//   • Image: the Nano Banana (Gemini) generator. POSTs to /api/gallery/generate
//     (runs the local banana-maker skill); output saves to the gallery
//     "Generated" section, so it shows on /gallery automatically.
//   • Video: the existing Free Video Maker app (multi-provider: Veo / Sora /
//     Replicate / fal), embedded from its always-on local server on :8765. Its
//     finished renders save into renders/ = the gallery "Free Video Maker"
//     section, so videos also appear on /gallery automatically.
import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { apiPost, dashboardToken } from '@/lib/api';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

// <img> can't send the fetch auth header — append the dashboard token (if any)
// so the result image loads when Bearer auth is enabled; no-op when disabled.
const withTok = (u: string) => (dashboardToken ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}` : u);

// The Free Video Maker server (durable systemd service, loopback). Embedded in
// the Video tab; it has no X-Frame-Options so it frames fine.
const VIDEO_URL = 'http://localhost:8765/';

interface GenResult { ok: boolean; file?: string; url?: string; notes?: string; error?: string; }

const MODELS = [
  { value: 'flash', label: 'Flash — Nano Banana 2 (fast)' },
  { value: 'pro', label: 'Pro — Nano Banana Pro (high fidelity)' },
  { value: 'grounded', label: 'Grounded — Flash + web/image search' },
];
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const SIZES = ['512', '1K', '2K', '4K'];

const selectStyle = {
  background: '#0d1117', color: '#e0e0e0', border: '1px solid #1a3a4a',
  borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: MONO, cursor: 'pointer',
};
const labelStyle = { fontSize: '10px', color: '#607d8b', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO };
const tabStyle = (active: boolean) => ({
  fontSize: '13px', fontWeight: 700, fontFamily: MONO, letterSpacing: '0.5px',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
  color: active ? '#06210f' : '#90a4ae',
  background: active ? '#34d39a' : '#0d1420',
  border: '1px solid ' + (active ? '#34d39a' : '#1a2332'),
});

export function Create() {
  const [tab, setTab] = useState<'image' | 'video'>(
    typeof window !== 'undefined' && window.location.hash === '#video' ? 'video' : 'image',
  );

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('flash');
  const [aspect, setAspect] = useState('1:1');
  const [size, setSize] = useState('2K');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  const canSubmit = prompt.trim().length > 0 && !busy;
  const sizeOptions = model === 'pro' ? SIZES.filter((s) => s !== '512') : SIZES;

  const generate = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await apiPost<GenResult>('/api/gallery/generate', {
        prompt: prompt.trim(), model, aspectRatio: aspect, size: model === 'pro' && size === '512' ? '1K' : size,
      });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Create" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: tab === 'video' ? '1200px' : '900px', margin: '0 auto' }}>

          {/* tab switcher */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
            <button type="button" onClick={() => { setTab('image'); try { history.replaceState(null, '', '#image'); } catch {} }} style={tabStyle(tab === 'image')}>🖼 Image</button>
            <button type="button" onClick={() => { setTab('video'); try { history.replaceState(null, '', '#video'); } catch {} }} style={tabStyle(tab === 'video')}>🎬 Video</button>
          </div>

          {tab === 'image' ? (
            <>
              <p style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO, margin: '0 0 16px' }}>
                Generate images with Nano Banana (Gemini). Output is saved to the{' '}
                <a href="/gallery" style={{ color: '#7fd1ff' }}>Gallery</a> automatically.
              </p>

              <div style={{ background: 'linear-gradient(180deg, #0d1420 0%, #0a1115 100%)', border: '1px solid #1a2332', borderRadius: '10px', padding: '20px' }}>
                <div style={labelStyle}>PROMPT</div>
                <textarea
                  value={prompt}
                  onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
                  placeholder="A neon-lit candlestick chart exploding upward, cinematic, dramatic lighting…"
                  rows={4}
                  disabled={busy}
                  style={{ width: '100%', background: '#0d1117', color: '#e0e0e0', border: '1px solid #1a3a4a', borderRadius: '8px', padding: '12px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                />

                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '14px' }}>
                  <div>
                    <div style={labelStyle}>MODEL</div>
                    <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...selectStyle, minWidth: '260px' }}>
                      {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>ASPECT</div>
                    <select value={aspect} onChange={(e) => setAspect((e.target as HTMLSelectElement).value)} disabled={busy} style={selectStyle}>
                      {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>SIZE</div>
                    <select value={size} onChange={(e) => setSize((e.target as HTMLSelectElement).value)} disabled={busy} style={selectStyle}>
                      {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '18px' }}>
                  <button
                    type="button"
                    onClick={generate}
                    disabled={!canSubmit}
                    style={{
                      fontSize: '14px', fontWeight: 700, fontFamily: MONO, letterSpacing: '0.5px',
                      color: canSubmit ? '#06210f' : '#607d8b',
                      background: canSubmit ? '#34d39a' : '#16323f',
                      border: 'none', borderRadius: '8px', padding: '10px 22px',
                      cursor: canSubmit ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {busy ? 'Generating…' : '✦ Generate'}
                  </button>
                  {busy && <span style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO }}>Nano Banana is working — this can take ~10–40s.</span>}
                </div>
              </div>

              {result && (
                <div style={{ marginTop: '20px' }}>
                  {result.ok && result.url ? (
                    <div style={{ border: '1px solid #1a3a4a', borderRadius: '10px', overflow: 'hidden', background: '#0d1117' }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a2332', fontSize: '12px', color: '#34d39a', fontFamily: MONO }}>
                        ✓ Saved to Gallery · {result.file}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', padding: '14px', background: '#07090d' }}>
                        <img src={withTok(result.url)} alt={result.file} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '6px' }} />
                      </div>
                      {result.notes && (
                        <div style={{ padding: '10px 14px', fontSize: '12px', color: '#90a4ae', fontFamily: MONO, borderTop: '1px solid #1a2332' }}>{result.notes}</div>
                      )}
                      <div style={{ padding: '10px 14px' }}>
                        <a href="/gallery" style={{ fontSize: '12px', color: '#7fd1ff', fontFamily: MONO }}>→ View in Gallery</a>
                      </div>
                    </div>
                  ) : (
                    <div style={{ border: '1px solid rgba(239,83,80,0.3)', background: 'rgba(239,83,80,0.08)', borderRadius: '10px', padding: '14px 16px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef5350', fontFamily: MONO, marginBottom: '4px' }}>Generation failed</div>
                      <div style={{ fontSize: '13px', color: '#e0a0a0', fontFamily: MONO }}>{result.error}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO, margin: '0 0 14px' }}>
                Generate videos with Free Video Maker (Veo · Sora · Replicate · fal). Finished renders save to the{' '}
                <a href="/gallery" style={{ color: '#7fd1ff' }}>Gallery</a> automatically.{' '}
                <a href={VIDEO_URL} target="_blank" rel="noreferrer" style={{ color: '#7fd1ff' }}>↗ open in a new tab</a>
              </p>
              <iframe
                src={VIDEO_URL}
                title="Free Video Maker"
                style={{ width: '100%', height: '80vh', border: '1px solid #1a2332', borderRadius: '10px', background: '#07090d' }}
              />
              <p style={{ fontSize: '11px', color: '#4b5563', fontFamily: MONO, margin: '10px 0 0' }}>
                Embedded from the local Free Video Maker service (localhost:8765). Video generation uses paid provider APIs.
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
