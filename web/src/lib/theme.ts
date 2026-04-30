import { signal, effect } from '@preact/signals';

export type ThemeName = 'graphite' | 'midnight' | 'crimson';

const STORAGE_KEY = 'claudeclaw.theme';

function loadInitial(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'graphite' || saved === 'midnight' || saved === 'crimson') {
      return saved;
    }
  } catch {}
  return 'graphite';
}

export const theme = signal<ThemeName>(loadInitial());

export const themeMeta: Record<ThemeName, { label: string; swatch: string }> = {
  graphite: { label: 'Graphite', swatch: '#8b8af0' },
  midnight: { label: 'Midnight', swatch: '#5eb6ff' },
  crimson: { label: 'Crimson', swatch: '#ff5e6e' },
};

// Apply to <html> and persist whenever the signal changes.
effect(() => {
  const next = theme.value;
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
});

export function setTheme(next: ThemeName) {
  theme.value = next;
}
