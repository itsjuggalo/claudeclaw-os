export interface ContextHealth {
  contextPct?: number;
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextLeftTokens?: number;
  contextUpdatedAt?: number | null;
  healthRefreshedAt?: number | null;
}

export function formatTokenCount(tokens: number | null | undefined): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return '-';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function formatClock(timestampSec: number | null | undefined): string {
  if (!timestampSec) return '-';
  return new Date(timestampSec * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function contextSummary(context: ContextHealth): string {
  const pct = typeof context.contextPct === 'number' ? context.contextPct : 0;
  if (typeof context.contextLeftTokens === 'number' && typeof context.contextWindowTokens === 'number') {
    return `${formatTokenCount(context.contextLeftTokens)} left · ${pct}% used`;
  }
  return `${pct}% used`;
}

export function contextDetail(context: ContextHealth): string {
  const pct = typeof context.contextPct === 'number' ? context.contextPct : 0;
  return [
    `Used: ${formatTokenCount(context.contextUsedTokens)} (${pct}%)`,
    `Left: ${formatTokenCount(context.contextLeftTokens)}`,
    `Window: ${formatTokenCount(context.contextWindowTokens)}`,
    `Context updated: ${formatClock(context.contextUpdatedAt)}`,
    `Health refreshed: ${formatClock(context.healthRefreshedAt)}`,
  ].join(' · ');
}
