// Video Game — Market Quest, the stock-market learning game. The game ships as
// ONE self-contained HTML file at web/public/assets/market-quest.html (built
// standalone at C:\AIWorkWindows\market-quest via scripts/singlefile.mjs).
// The backend only whitelists /assets/* statics (html = octet-stream), so we
// fetch the file and render it via iframe srcdoc — zero backend changes, and
// the game's localStorage saves live on this origin. Fictional market,
// fictional money; no API, no real trading.
import { useEffect, useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { ExternalLink } from 'lucide-preact';

const GAME_URL = '/assets/market-quest.html';

export function VideoGame() {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(GAME_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHtml)
      .catch((e: Error) => setError(e.message));
  }, []);

  const openFullscreen = () => {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
  };

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Video Game"
        breadcrumb="Trade"
        actions={
          <button
            type="button"
            onClick={openFullscreen}
            disabled={!html}
            class="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <ExternalLink size={13} /> Full-screen
          </button>
        }
      />
      <div class="flex-1 min-h-0 p-3 md:p-4">
        {error ? (
          <div class="flex h-full items-center justify-center text-[13px] text-[var(--color-text-muted)]">
            Couldn't load the game ({error}). Rebuild with `npm run build:web` after refreshing
            web/public/assets/market-quest.html.
          </div>
        ) : !html ? (
          <div class="flex h-full items-center justify-center text-[13px] text-[var(--color-text-faint)]">
            Loading Market Quest…
          </div>
        ) : (
          <iframe
            srcdoc={html}
            title="Market Quest — stock market learning game"
            class="h-full w-full rounded-lg border border-[var(--color-border)] bg-[#0d1120]"
          />
        )}
      </div>
    </div>
  );
}
