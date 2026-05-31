// Create — generate media into the Gallery, with selectable engines per tab.
//   Image: Nano Banana (Gemini, paid) OR Local SDXL-Turbo (free, on-GPU).
//   Video: Local LTX-Video (free, on-GPU) OR the embedded Free Video Maker app.
// Everything saves into gallery-watched folders, so output appears on /gallery
// automatically. Local engines need no API key/credits (diffusers in
// ~/01_ACTIVE/local-gen, runs on the GPU; first use downloads the model once).
import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { apiPost, dashboardToken } from '@/lib/api';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const withTok = (u: string) => (dashboardToken ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}` : u);
const VIDEO_URL = 'http://localhost:8765/';

interface GenResult { ok: boolean; file?: string; url?: string; notes?: string; error?: string; }

const BANANA_MODELS = [
  { value: 'flash', label: 'Flash — Nano Banana 2 (fast)' },
  { value: 'pro', label: 'Pro — Nano Banana Pro (high fidelity)' },
  { value: 'grounded', label: 'Grounded — Flash + web/image search' },
];
const LOCAL_IMG_MODELS = [
  { value: 'sdxl-turbo', label: 'SDXL-Turbo (free, sharper)' },
  { value: 'sd-turbo', label: 'SD-Turbo (free, lighter/faster)' },
];
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const SIZES = ['512', '1K', '2K', '4K'];

const selectStyle = {
  background: '#0d1117', color: '#e0e0e0', border: '1px solid #1a3a4a',
  borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: MONO, cursor: 'pointer',
};
const labelStyle = { fontSize: '10px', color: '#607d8b', letterSpacing: '1.5px', marginBottom: '6px', fontFamily: MONO };
const taStyle = { width: '100%', background: '#0d1117', color: '#e0e0e0', border: '1px solid #1a3a4a', borderRadius: '8px', padding: '12px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' as const, boxSizing: 'border-box' as const };
const tabStyle = (active: boolean) => ({
  fontSize: '13px', fontWeight: 700, fontFamily: MONO, letterSpacing: '0.5px', padding: '8px 18px',
  borderRadius: '8px', cursor: 'pointer', color: active ? '#06210f' : '#90a4ae',
  background: active ? '#34d39a' : '#0d1420', border: '1px solid ' + (active ? '#34d39a' : '#1a2332'),
});
const genBtn = (enabled: boolean) => ({
  fontSize: '14px', fontWeight: 700, fontFamily: MONO, letterSpacing: '0.5px',
  color: enabled ? '#06210f' : '#607d8b', background: enabled ? '#34d39a' : '#16323f',
  border: 'none', borderRadius: '8px', padding: '10px 22px', cursor: enabled ? 'pointer' : 'not-allowed',
});

function ResultBox({ result, kind }: { result: GenResult; kind: 'image' | 'video' }) {
  if (result.ok && result.url) {
    return (
      <div style={{ marginTop: '20px', border: '1px solid #1a3a4a', borderRadius: '10px', overflow: 'hidden', background: '#0d1117' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a2332', fontSize: '12px', color: '#34d39a', fontFamily: MONO }}>✓ Saved to Gallery · {result.file}</div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '14px', background: '#07090d' }}>
          {kind === 'video'
            ? <video src={withTok(result.url)} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '6px' }} />
            : <img src={withTok(result.url)} alt={result.file} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '6px' }} />}
        </div>
        <div style={{ padding: '10px 14px' }}><a href="/gallery" style={{ fontSize: '12px', color: '#7fd1ff', fontFamily: MONO }}>→ View in Gallery</a></div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: '20px', border: '1px solid rgba(239,83,80,0.3)', background: 'rgba(239,83,80,0.08)', borderRadius: '10px', padding: '14px 16px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef5350', fontFamily: MONO, marginBottom: '4px' }}>Generation failed</div>
      <div style={{ fontSize: '13px', color: '#e0a0a0', fontFamily: MONO }}>{result.error}</div>
    </div>
  );
}

export function Create() {
  const [tab, setTab] = useState<'image' | 'video'>(
    typeof window !== 'undefined' && window.location.hash === '#video' ? 'video' : 'image',
  );

  // image state
  const [imgEngine, setImgEngine] = useState<'banana' | 'local'>('local');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('flash');
  const [aspect, setAspect] = useState('1:1');
  const [size, setSize] = useState('2K');
  const [localModel, setLocalModel] = useState('sdxl-turbo');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  // video state
  const [vidEngine, setVidEngine] = useState<'local' | 'fvm'>('local');
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidBusy, setVidBusy] = useState(false);
  const [vidResult, setVidResult] = useState<GenResult | null>(null);

  const sizeOptions = model === 'pro' ? SIZES.filter((s) => s !== '512') : SIZES;
  const canImg = prompt.trim().length > 0 && !busy;
  const canVid = vidPrompt.trim().length > 0 && !vidBusy;

  const genImage = async () => {
    if (!canImg) return;
    setBusy(true); setResult(null);
    try {
      const body = imgEngine === 'local'
        ? { source: 'local', prompt: prompt.trim(), model: localModel, steps: 3 }
        : { prompt: prompt.trim(), model, aspectRatio: aspect, size: model === 'pro' && size === '512' ? '1K' : size };
      setResult(await apiPost<GenResult>('/api/gallery/generate', body));
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const genVideo = async () => {
    if (!canVid) return;
    setVidBusy(true); setVidResult(null);
    try {
      setVidResult(await apiPost<GenResult>('/api/gallery/generate-video', { prompt: vidPrompt.trim() }));
    } catch (e) {
      setVidResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setVidBusy(false); }
  };

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Create" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: tab === 'video' && vidEngine === 'fvm' ? '1200px' : '900px', margin: '0 auto' }}>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
            <button type="button" onClick={() => { setTab('image'); try { history.replaceState(null, '', '#image'); } catch {} }} style={tabStyle(tab === 'image')}>🖼 Image</button>
            <button type="button" onClick={() => { setTab('video'); try { history.replaceState(null, '', '#video'); } catch {} }} style={tabStyle(tab === 'video')}>🎬 Video</button>
          </div>

          {tab === 'image' ? (
            <>
              <div style={{ background: 'linear-gradient(180deg, #0d1420 0%, #0a1115 100%)', border: '1px solid #1a2332', borderRadius: '10px', padding: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '14px' }}>
                  <div>
                    <div style={labelStyle}>ENGINE</div>
                    <select value={imgEngine} onChange={(e) => setImgEngine((e.target as HTMLSelectElement).value as 'banana' | 'local')} disabled={busy} style={{ ...selectStyle, minWidth: '240px' }}>
                      <option value="local">Local — SDXL-Turbo (free, on-GPU)</option>
                      <option value="banana">Nano Banana — Gemini (paid)</option>
                    </select>
                  </div>
                  {imgEngine === 'local' ? (
                    <div>
                      <div style={labelStyle}>MODEL</div>
                      <select value={localModel} onChange={(e) => setLocalModel((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...selectStyle, minWidth: '240px' }}>
                        {LOCAL_IMG_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div style={labelStyle}>MODEL</div>
                        <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)} disabled={busy} style={{ ...selectStyle, minWidth: '240px' }}>
                          {BANANA_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div><div style={labelStyle}>ASPECT</div>
                        <select value={aspect} onChange={(e) => setAspect((e.target as HTMLSelectElement).value)} disabled={busy} style={selectStyle}>{ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                      </div>
                      <div><div style={labelStyle}>SIZE</div>
                        <select value={size} onChange={(e) => setSize((e.target as HTMLSelectElement).value)} disabled={busy} style={selectStyle}>{sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                      </div>
                    </>
                  )}
                </div>

                <div style={labelStyle}>PROMPT</div>
                <textarea value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} placeholder="A neon-lit candlestick chart exploding upward, cinematic…" rows={4} disabled={busy} style={taStyle} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '16px' }}>
                  <button type="button" onClick={genImage} disabled={!canImg} style={genBtn(canImg)}>{busy ? 'Generating…' : '✦ Generate'}</button>
                  {busy && <span style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO }}>{imgEngine === 'local' ? 'Running on the GPU — first use downloads the model once.' : 'Nano Banana is working — ~10–40s.'}</span>}
                </div>
              </div>
              {result && <ResultBox result={result} kind="image" />}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
                <div>
                  <div style={labelStyle}>ENGINE</div>
                  <select value={vidEngine} onChange={(e) => setVidEngine((e.target as HTMLSelectElement).value as 'local' | 'fvm')} style={{ ...selectStyle, minWidth: '300px' }}>
                    <option value="local">Local — LTX-Video (free, on-GPU)</option>
                    <option value="fvm">Free Video Maker (Veo/Sora/Replicate/fal · paid)</option>
                  </select>
                </div>
              </div>

              {vidEngine === 'local' ? (
                <>
                  <div style={{ background: 'linear-gradient(180deg, #0d1420 0%, #0a1115 100%)', border: '1px solid #1a2332', borderRadius: '10px', padding: '20px' }}>
                    <div style={labelStyle}>PROMPT</div>
                    <textarea value={vidPrompt} onInput={(e) => setVidPrompt((e.target as HTMLTextAreaElement).value)} placeholder="A golden bull charging through a glowing stock chart, cinematic, smooth motion" rows={4} disabled={vidBusy} style={taStyle} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '16px' }}>
                      <button type="button" onClick={genVideo} disabled={!canVid} style={genBtn(canVid)}>{vidBusy ? 'Generating…' : '✦ Generate Video'}</button>
                      <span style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO }}>
                        {vidBusy ? 'Rendering on the GPU — this takes a few minutes (first run also downloads the model).' : 'Free, on-GPU. Needs free VRAM (close BlueStacks/WSA if it errors).'}
                      </span>
                    </div>
                  </div>
                  {vidResult && <ResultBox result={vidResult} kind="video" />}
                </>
              ) : (
                <>
                  <p style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO, margin: '0 0 12px' }}>
                    Finished renders save to the <a href="/gallery" style={{ color: '#7fd1ff' }}>Gallery</a> automatically.{' '}
                    <a href={VIDEO_URL} target="_blank" rel="noreferrer" style={{ color: '#7fd1ff' }}>↗ open in a new tab</a>
                  </p>
                  <iframe src={VIDEO_URL} title="Free Video Maker" style={{ width: '100%', height: '78vh', border: '1px solid #1a2332', borderRadius: '10px', background: '#07090d' }} />
                </>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
