import { describe, it, expect } from 'vitest';
import {
  isReservedOrigin,
  resolveHandbackDestination,
  RESERVED_ORIGINS,
  MAIN_AGENT_ID,
} from './routing.js';

describe('isReservedOrigin', () => {
  it('flags the named non-agent sentinels', () => {
    expect(isReservedOrigin('dashboard')).toBe(true);
    expect(isReservedOrigin('human')).toBe(true);
    expect(isReservedOrigin('scheduled')).toBe(true);
  });
  it('flags numeric chat ids and cron origins', () => {
    expect(isReservedOrigin('123456')).toBe(true);
    expect(isReservedOrigin('-1001234567')).toBe(true);
    expect(isReservedOrigin('cron:daily-scan')).toBe(true);
  });
  it('is case-insensitive and trims', () => {
    expect(isReservedOrigin(' Dashboard ')).toBe(true);
  });
  it('does not flag ordinary agent ids', () => {
    expect(isReservedOrigin('main')).toBe(false);
    expect(isReservedOrigin('research')).toBe(false);
    expect(isReservedOrigin('some-agent')).toBe(false);
  });
});

describe('resolveHandbackDestination', () => {
  it('routes any non-reserved origin straight back to it as an agent id (roster-free)', () => {
    expect(resolveHandbackDestination('research')).toEqual({ kind: 'agent', agent: 'research' });
    expect(resolveHandbackDestination('some-agent')).toEqual({ kind: 'agent', agent: 'some-agent' });
    expect(resolveHandbackDestination('main')).toEqual({ kind: 'agent', agent: 'main' });
  });
  it('lowercases/trims the resolved agent id', () => {
    expect(resolveHandbackDestination(' Research ')).toEqual({ kind: 'agent', agent: 'research' });
  });
  it('surfaces dashboard/human/chat-id to the human via the primary agent', () => {
    for (const origin of ['dashboard', 'human', '-100999']) {
      const d = resolveHandbackDestination(origin);
      expect(d.kind).toBe('human');
      if (d.kind === 'human') expect(d.via).toBe(MAIN_AGENT_ID);
    }
  });
  it('surfaces scheduled/cron origins to the human', () => {
    expect(resolveHandbackDestination('scheduled').kind).toBe('human');
    expect(resolveHandbackDestination('cron:x').kind).toBe('human');
  });
  it('never dead-ends: every input resolves to agent or human', () => {
    for (const origin of ['dashboard', 'human', 'scheduled', 'cron:y', '42', 'anything', 'main']) {
      expect(['agent', 'human']).toContain(resolveHandbackDestination(origin).kind);
    }
  });
  it('carries no compiled-in fleet roster', () => {
    // The only reserved names are generic runtime concepts, not customer agents.
    expect([...RESERVED_ORIGINS].sort()).toEqual(['dashboard', 'human', 'scheduled']);
  });
});
