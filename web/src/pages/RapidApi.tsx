// RapidAPI search console — pick a subscribed RapidAPI from the dropdown, type a
// query, results render below. Calls the server route /api/rapidapi/* (the key
// stays server-side). Results open in a new tab and play inline when the API
// returns a playable URL. Add APIs in src/rapidapi.ts — the dropdown is dynamic.
import { useState } from 'preact/hooks';
import { ExternalLink, Search, Play } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

interface ApiDef { id: string; label: string; nsfw?: boolean; }
interface MediaResult { title: string; url: string; thumbnail?: string; stream?: string; duration?: string; }

export function RapidApi() {
  const { data: apisData } = useFetch<{ apis: ApiDef[] }>('/api/rapidapi/apis');
  const apis = apisData?.apis ?? [];

  const [api, setApi] = useState('');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');          // committed on submit
  const [playing, setPlaying] = useState<string | null>(null);

  const effApi = api || apis[0]?.id || '';
  const path = effApi && query
    ? `/api/rapidapi/search?api=${encodeURIComponent(effApi)}&q=${encodeURIComponent(query)}`
    : null;
  const { data, loading, error } = useFetch<{ results: MediaResult[]; cached?: boolean }>(path);
  const results = data?.results ?? [];

  function submit(e?: Event) {
    e?.preventDefault();
    setPlaying(null);
    setQuery(input.trim());
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="RapidAPI" />
      <div class="flex-1 overflow-y-auto">
        <div style={{ padding: '20px 24px', maxWidth: '1200px', margin: '0 auto' }}>

          {/* ── API dropdown + search box ───────────────────────────── */}
          <form onSubmit={submit} class="flex flex-wrap items-stretch gap-2 mb-5">
            <select
              value={effApi}
              onChange={(e) => setApi((e.target as HTMLSelectElement).value)}
              class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-text)] outline-none"
            >
              {apis.length === 0 && <option value="">Loading APIs…</option>}
              {apis.map((a) => (
                <option value={a.id}>{a.label}{a.nsfw ? '  ·  18+' : ''}</option>
              ))}
            </select>
            <input
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              placeholder="Search this API…"
              class="flex-1 min-w-[200px] bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="submit"
              disabled={!effApi || !input.trim()}
              class="flex items-center gap-1.5 bg-[var(--color-accent)] text-white rounded-md px-4 py-2 text-[13px] font-medium disabled:opacity-50"
            >
              <Search size={15} /> Search
            </button>
          </form>

          {/* ── states ──────────────────────────────────────────────── */}
          {!query && (
            <PageState
              empty
              emptyTitle="Pick an API and search"
              emptyDescription="Choose an API from the dropdown, type a query, and results appear here. Nothing is downloaded — results open on the source site, or play inline when available."
            />
          )}
          {query && loading && <PageState loading />}
          {query && error && <PageState error={error} />}
          {query && !loading && !error && results.length === 0 && (
            <PageState empty emptyTitle="No results" emptyDescription={`Nothing came back for "${query}".`} />
          )}

          {/* ── results grid ────────────────────────────────────────── */}
          {results.length > 0 && (
            <div class="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {results.map((r, i) => (
                <div key={i} class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col">
                  {playing && playing === r.stream ? (
                    <video src={r.stream} controls autoPlay class="w-full aspect-video bg-black" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => (r.stream ? setPlaying(r.stream!) : window.open(r.url, '_blank', 'noopener'))}
                      class="relative block w-full aspect-video bg-black/40 cursor-pointer"
                    >
                      {r.thumbnail ? (
                        <img src={r.thumbnail} alt="" class="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div class="w-full h-full flex items-center justify-center text-[var(--color-text-faint)] text-[12px]">no preview</div>
                      )}
                      {r.stream && (
                        <span class="absolute inset-0 flex items-center justify-center">
                          <Play size={30} class="text-white/90" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.6))' }} />
                        </span>
                      )}
                      {r.duration && (
                        <span class="absolute bottom-1 right-1 text-[10px] bg-black/70 text-white px-1 rounded tabular-nums">{r.duration}</span>
                      )}
                    </button>
                  )}
                  <div class="p-2 flex flex-col gap-1">
                    <div class="text-[12px] text-[var(--color-text)] line-clamp-2" title={r.title}>{r.title}</div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      class="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 w-fit"
                    >
                      <ExternalLink size={11} /> Open
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
