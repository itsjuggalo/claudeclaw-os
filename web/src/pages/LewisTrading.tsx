// Lewis Trading — integrations harvested from Lewis Jackson's "YouTube Video
// Prompts" course (zero-one Skool). Kept separate from Skool Builds so the
// Lewis material doesn't get mixed in with other communities. Each card shows
// the one-shot prompt + video transcript, a verdict, and a "how to use" note.
// Data: GET /api/lewis-trading ; file content: GET /api/lewis-trading/file?id&name
// (see src/lewistrading.ts). Edit ~/.claudeclaw/lewis-trading.json to add more.
import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiGet } from '@/lib/api';
import { TrendingUp, PlayCircle, ExternalLink, FileCode, FileText, ChevronRight, Lightbulb } from 'lucide-preact';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

interface IFile { name: string; path: string; lang?: string; label?: string; exists?: boolean; bytes?: number; lines?: number; }
interface Integration {
  id: string; title: string; lesson?: string; sourceUrl?: string; video?: string;
  createdAt?: string; verdict?: string; summary?: string; useHow?: string;
  tags?: string[]; files: IFile[];
}
interface ArtifactResp { name: string; lang: string; content: string; truncated: boolean; }

// verdict -> { color, label }
const verdictMeta = (v?: string): { color: string; label: string } => {
  switch ((v || '').toLowerCase()) {
    case 'installed':  return { color: '#66bb6a', label: 'INSTALLED' };
    case 'integrate':  return { color: '#4fc3f7', label: 'INTEGRATE' };
    case 'standalone': return { color: '#ffb74d', label: 'STANDALONE' };
    case 'overlap':    return { color: '#ce93d8', label: 'OVERLAP' };
    default:           return { color: '#90a4ae', label: (v || 'NOTE').toUpperCase() };
  }
};

const fmtBytes = (n?: number): string => {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
};

export function LewisTrading() {
  const { data, loading, error } = useFetch<Integration[]>('/api/lewis-trading', 60_000);
  const items: Integration[] = Array.isArray(data) ? data : [];

  if (error) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Lewis Trading" />
        <PageState error={error} />
      </div>
    );
  }
  if (loading && items.length === 0) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Lewis Trading" />
        <PageState loading />
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Lewis Trading" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO, marginBottom: '18px' }}>
            Lewis Jackson · ZeroOne "YouTube Video Prompts" · {items.length} integration{items.length === 1 ? '' : 's'} · prompt + transcript per video
          </div>
          {items.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#607d8b', fontSize: '13px', fontFamily: MONO, border: '1px dashed #1a2332', borderRadius: '8px' }}>
              Nothing yet. Add integrations to ~/.claudeclaw/lewis-trading.json
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {items.map((b) => <Card key={b.id} b={b} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ b }: { b: Integration }) {
  const vm = verdictMeta(b.verdict);
  return (
    <div style={{
      background: 'linear-gradient(180deg, #0a1929 0%, #0d1420 100%)',
      border: '1px solid #1a3a4a',
      borderLeft: '3px solid ' + vm.color,
      borderRadius: '8px',
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <TrendingUp size={15} color={vm.color} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO }}>{b.title}</span>
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '3px', fontFamily: MONO, letterSpacing: '1px', background: vm.color + '22', color: vm.color, border: '1px solid ' + vm.color + '44' }}>
              {vm.label}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#607d8b', fontFamily: MONO }}>
            {b.lesson}{b.createdAt ? ' · ' + b.createdAt : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          {b.video && <LinkBtn href={b.video} icon={<PlayCircle size={13} />} label="Video" color="#ef5350" />}
          {b.sourceUrl && <LinkBtn href={b.sourceUrl} icon={<ExternalLink size={13} />} label="Lesson" color="#4fc3f7" />}
        </div>
      </div>

      {b.summary && (
        <div style={{ marginTop: '12px', padding: '11px 13px', background: '#0d1117', borderRadius: '6px', fontSize: '12px', color: '#b0bec5', fontFamily: MONO, lineHeight: 1.6 }}>
          {b.summary}
        </div>
      )}

      {b.useHow && (
        <div style={{ marginTop: '10px', padding: '11px 13px', background: vm.color + '10', border: '1px solid ' + vm.color + '33', borderRadius: '6px', display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
          <Lightbulb size={14} color={vm.color} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '12px', color: '#cfd8dc', fontFamily: MONO, lineHeight: 1.6 }}>{b.useHow}</div>
        </div>
      )}

      {b.tags && b.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
          {b.tags.map((t) => (
            <span key={t} style={{ fontSize: '9px', fontFamily: MONO, color: '#90a4ae', background: '#1a2332', padding: '3px 8px', borderRadius: '10px', letterSpacing: '0.5px' }}>#{t}</span>
          ))}
        </div>
      )}

      <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '9px', color: '#607d8b', letterSpacing: '1.5px', fontFamily: MONO }}>FILES ({b.files.length})</div>
        {b.files.map((f) => <FileRow key={f.name} itemId={b.id} f={f} />)}
      </div>
    </div>
  );
}

function LinkBtn({ href, icon, label, color }: { href: string; icon: any; label: string; color: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      display: 'flex', alignItems: 'center', gap: '5px',
      fontSize: '10px', fontWeight: 600, fontFamily: MONO,
      color, background: color + '14', border: '1px solid ' + color + '33',
      padding: '5px 9px', borderRadius: '5px', textDecoration: 'none', letterSpacing: '0.5px',
    }}>{icon}{label}</a>
  );
}

function FileRow({ itemId, f }: { itemId: string; f: IFile }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<ArtifactResp | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCode = (f.lang || '').match(/pine|js|ts|py|go|sh|json|md/);
  const Icon = isCode ? FileCode : FileText;
  const missing = f.exists === false;

  const toggle = async () => {
    if (missing) return;
    const next = !open;
    setOpen(next);
    if (next && !content && !loadingFile) {
      setLoadingFile(true);
      setErr(null);
      try {
        const resp = await apiGet<ArtifactResp>(`/api/lewis-trading/file?id=${encodeURIComponent(itemId)}&name=${encodeURIComponent(f.name)}`);
        setContent(resp);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoadingFile(false);
      }
    }
  };

  return (
    <div style={{ border: '1px solid #1a2332', borderRadius: '6px', overflow: 'hidden' }}>
      <div onClick={toggle} style={{
        display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px',
        background: '#0d1117', cursor: missing ? 'default' : 'pointer', opacity: missing ? 0.5 : 1,
      }}>
        <ChevronRight size={13} color="#607d8b" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        <Icon size={14} color={isCode ? '#4fc3f7' : '#ce93d8'} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#e0e0e0', fontFamily: MONO }}>{f.label || f.name}</span>
        <span style={{ fontSize: '10px', color: '#607d8b', fontFamily: MONO }}>{f.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#607d8b', fontFamily: MONO }}>
          {missing ? 'MISSING' : `${f.lines ? f.lines + ' lines · ' : ''}${fmtBytes(f.bytes)}`}
        </span>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #1a2332' }}>
          {loadingFile && <div style={{ padding: '14px', fontSize: '11px', color: '#607d8b', fontFamily: MONO }}>Loading…</div>}
          {err && <div style={{ padding: '14px', fontSize: '11px', color: '#ef5350', fontFamily: MONO }}>{err}</div>}
          {content && (
            <>
              {content.truncated && (
                <div style={{ padding: '6px 12px', fontSize: '10px', color: '#ff9800', fontFamily: MONO, background: '#ff980011' }}>
                  Truncated — open the file directly for the full content.
                </div>
              )}
              <pre style={{
                margin: 0, padding: '14px', maxHeight: '460px', overflow: 'auto',
                fontSize: '11px', lineHeight: 1.5, color: '#cfd8dc', fontFamily: MONO,
                background: '#070b0f', whiteSpace: 'pre-wrap', wordBreak: 'break-word', tabSize: 4,
              }}>{content.content}</pre>
              <div style={{ padding: '7px 12px', fontSize: '9px', color: '#607d8b', fontFamily: MONO, background: '#0d1117', borderTop: '1px solid #1a2332' }}>
                {f.path}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
