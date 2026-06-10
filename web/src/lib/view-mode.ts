import { signal, effect } from '@preact/signals';
import { uiScale } from './theme';

export type ViewMode = 'auto' | 'desktop';

const VIEW_MODE_KEY = 'claudeclaw.viewMode';

/** Layout-viewport width forced when desktop view is on. Wide enough
 *  that every `md:` (768px) media query matches and the layout renders
 *  exactly as it does in a desktop browser window. */
const DESKTOP_WIDTH = 1100;

const AUTO_CONTENT = 'width=device-width, initial-scale=1.0, user-scalable=no';

function loadInitial(): ViewMode {
  try {
    if (localStorage.getItem(VIEW_MODE_KEY) === 'desktop') return 'desktop';
  } catch {}
  return 'auto';
}

/** 'auto' = native device layout (mobile drawer below 768px).
 *  'desktop' = force the full desktop layout on phones by widening the
 *  layout viewport — the same trick as the browser's "Request Desktop
 *  Site". A no-op in real desktop browsers (they ignore viewport meta). */
export const viewMode = signal<ViewMode>(loadInitial());

// Keep the viewport meta + localStorage in sync. The meta width is
// multiplied by uiScale because theme.ts applies CSS `zoom` to <html>:
// effective layout width = metaWidth / zoom, so scaling both keeps the
// effective layout at a constant DESKTOP_WIDTH and avoids horizontal
// overflow at uiScale > 1. The pre-paint bootstrap in index.html applies
// the same formula so a reload comes up correctly fitted.
effect(() => {
  const mode = viewMode.value;
  const content = mode === 'desktop'
    ? `width=${Math.round(DESKTOP_WIDTH * uiScale.value)}, user-scalable=yes`
    : AUTO_CONTENT;
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', content);
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
});

export function setViewMode(next: ViewMode) {
  if (next === viewMode.value) return;
  viewMode.value = next; // effect persists to localStorage synchronously
  // Browsers only compute the auto-fit visual scale at page load — a live
  // meta swap changes the layout width but leaves the user at the old
  // zoom, staring at one corner of the page. Reload so the new mode comes
  // up fitted (the index.html bootstrap applies the meta before paint).
  location.reload();
}
