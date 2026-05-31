// Gallery — every generated image/video, surfaced from the same local source
// folders as the :8090 BobaCatTrades + Nano Banana gallery, but served by this
// dashboard (same-origin). Data: GET /api/gallery; files stream from
// GET /api/gallery/file (see src/gallery.ts). Click a tile for a full-res view.
import { useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

interface GFile { name: string; url: string; type: 'image' | 'video'; }
interface GSection { id: string; title: string; desc: string; count: number; files: GFile[]; }

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";

export function Gallery() {
  const { data, loading, error, refresh } = useFetch<GSection[]>('/api/gallery', 60_000);
  const sections: GSection[] = Array.isArray(data) ? data : [];
  const [lightbox, setLightbox] = useState<GFile | null>(null);

  if (error) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Gallery" />
        <PageState error={error} />
      </div>
    );
  }
  if (loading && sections.length === 0) {
    return (
      <div class="flex flex-col h-full">
        <PageHeader title="Gallery" />
        <PageState loading />
      </div>
    );
  }

  const total = sections.reduce((s, x) => s + x.count, 0);

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Gallery" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: '#607d8b', fontFamily: MONO, letterSpacing: '1px' }}>
              {total} ASSET{total === 1 ? '' : 'S'} · {sections.length} SECTION{sections.length === 1 ? '' : 'S'} · live from local generation folders
            </div>
            <button
              type="button"
              onClick={() => refresh()}
              style={{ fontSize: '12px', color: '#7fd1ff', background: '#16323f', border: '1px solid #244b5c', borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', fontFamily: MONO, fontWeight: 700 }}
            >
              ↻ Refresh
            </button>
          </div>

          {sections.length === 0 ? (
            <PageState empty emptyTitle="No generated media yet" emptyDescription="Generate an image or video and it'll appear here automatically." />
          ) : (
            sections.map((sec) => (
              <section key={sec.id} style={{ marginBottom: '32px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, borderLeft: '4px solid #34d39a', padding: '0 0 0 11px', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, padding: '2px 10px', borderRadius: '999px', background: '#34d39a', color: '#06210f' }}>{sec.count}</span>
                  {sec.title}
                </h2>
                <p style={{ fontSize: '12px', color: '#607d8b', margin: '0 0 14px', fontFamily: MONO }}>{sec.desc}</p>
                <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {sec.files.map((f) => (
                    <figure
                      key={f.url}
                      class="transition-transform duration-100 hover:-translate-y-0.5"
                      style={{ margin: 0, background: 'rgba(21,28,37,0.5)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '12px', overflow: 'hidden', cursor: f.type === 'image' ? 'zoom-in' : 'default' }}
                      onClick={() => { if (f.type === 'image') setLightbox(f); }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '1 / 1', padding: '9px', background: '#0d1117' }}>
                        {f.type === 'video' ? (
                          <video src={f.url} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
                        ) : (
                          <img src={f.url} loading="lazy" alt={f.name} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
                        )}
                      </div>
                      <figcaption style={{ padding: '7px 10px', fontSize: '11px', color: '#8b97a4', fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.name}>
                        {f.name}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ))
          )}

        </div>
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(3,5,8,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '24px', cursor: 'zoom-out' }}
        >
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: '94vw', maxHeight: '86vh', borderRadius: '10px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} />
          <div style={{ fontSize: '12px', color: '#8b97a4', fontFamily: MONO }}>{lightbox.name}</div>
        </div>
      )}
    </div>
  );
}
