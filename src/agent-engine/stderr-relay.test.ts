import { describe, it, expect } from 'vitest';

import { makeStderrRelay } from './claude-sdk-adapter.js';

// One failing CLI hook produced 777 × ~5 KB stderr lines in a day: the relay
// must bound each snippet and squelch identical repeats instead of logging all.
describe('makeStderrRelay — truncation and repeat squelch', () => {
  it('truncates oversized chunks and reports the original length', () => {
    const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const relay = makeStderrRelay((obj, msg) => calls.push({ obj, msg }));
    relay('x'.repeat(5000));
    expect(calls).toHaveLength(1);
    const logged = calls[0].obj.stderr as string;
    expect(logged.length).toBeLessThan(600);
    expect(logged).toContain('[truncated, 5000 chars total]');
  });

  it('logs an identical repeating message once, then every 50th with the count', () => {
    const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const relay = makeStderrRelay((obj, msg) => calls.push({ obj, msg }));
    for (let i = 0; i < 120; i++) relay('Error in hook callback hook_0: same payload');
    expect(calls).toHaveLength(3); // 1st, 50th, 100th
    expect(calls[1].msg).toBe('claude subprocess stderr (repeating)');
    expect(calls[1].obj.repeats).toBe(50);
    expect(calls[2].obj.repeats).toBe(100);
  });

  it('resets the squelch when a different message arrives', () => {
    const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const relay = makeStderrRelay((obj, msg) => calls.push({ obj, msg }));
    relay('first error');
    relay('first error');
    relay('a different error');
    relay('first error');
    expect(calls.map((c) => c.obj.stderr)).toEqual(['first error', 'a different error', 'first error']);
  });
});
