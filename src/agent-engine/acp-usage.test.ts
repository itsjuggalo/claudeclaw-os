import { describe, it, expect } from 'vitest';
import { acpUsageFromUpdate } from './acp-adapter.js';

describe('acpUsageFromUpdate (#70)', () => {
  it('returns empty usage when the provider sent no usage_update', () => {
    const u = acpUsageFromUpdate(undefined);
    expect(u.contextWindow).toBeNull();
    expect(u.lastCallInputTokens).toBe(0);
    expect(u.inputTokens).toBe(0);
    expect(u.totalCostUsd).toBe(0);
  });

  it('maps point-in-time context size + fill from usage_update', () => {
    const u = acpUsageFromUpdate({ size: 200000, used: 12345 } as any);
    expect(u.contextWindow).toBe(200000);
    expect(u.lastCallInputTokens).toBe(12345);
  });

  it('does NOT map cumulative cost/per-turn tokens (avoids overcount)', () => {
    // Even if the update carries a cumulative cost, we leave the summed fields
    // at zero — downstream sums usage per turn, so cumulative would overcount.
    const u = acpUsageFromUpdate({ size: 200000, used: 999, cost: { amount: 4.2, currency: 'USD' } } as any);
    expect(u.totalCostUsd).toBe(0);
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
  });
});
