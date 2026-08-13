import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Regression test for the setup-wizard orphan bug: the config directory used
// to be frozen at import (const CLAUDECLAW_CONFIG). The wizard persisted the
// provider (agents/main/agent.yaml) BEFORE asking where config should live, so
// choosing a custom dir left the default ~/.claudeclaw created-and-orphaned.
//
// The fix makes getClaudeclawConfig() resolve process.env.CLAUDECLAW_CONFIG at
// CALL time, so a caller that sets the env var mid-run (the reordered wizard)
// redirects every subsequent write to the chosen dir. This test locks in that
// call-time behavior.
import { getClaudeclawConfig, expandHome } from './config.js';

const original = process.env.CLAUDECLAW_CONFIG;

describe('getClaudeclawConfig — call-time resolution', () => {
  beforeEach(() => {
    delete process.env.CLAUDECLAW_CONFIG;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDECLAW_CONFIG;
    else process.env.CLAUDECLAW_CONFIG = original;
  });

  it('honors process.env.CLAUDECLAW_CONFIG set after import', () => {
    const chosen = path.join(os.tmpdir(), 'claudeclaw-chosen-config');
    process.env.CLAUDECLAW_CONFIG = chosen;
    expect(getClaudeclawConfig()).toBe(chosen);
  });

  it('is not frozen — reflects a change between calls (no stale default)', () => {
    const first = path.join(os.tmpdir(), 'claudeclaw-first');
    const second = path.join(os.tmpdir(), 'claudeclaw-second');

    process.env.CLAUDECLAW_CONFIG = first;
    expect(getClaudeclawConfig()).toBe(first);

    // Simulate the wizard publishing the user's custom choice mid-run.
    process.env.CLAUDECLAW_CONFIG = second;
    expect(getClaudeclawConfig()).toBe(second);
    // The default must NOT leak through once a choice is published.
    expect(getClaudeclawConfig()).not.toBe(expandHome('~/.claudeclaw'));
  });
});
