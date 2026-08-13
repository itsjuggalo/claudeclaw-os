import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression test for: a fresh write of main's provider config (no
// agents/main/agent.yaml yet under CLAUDECLAW_CONFIG) must land in the
// external config dir, never in PROJECT_ROOT (the repo/install checkout).
//
// Before the fix, mainAgentYamlPath() picked the write target by checking
// whether the external file *already* exists. On a fresh install (or a
// fresh test run) it doesn't, so the very first write fell back to
// PROJECT_ROOT/agents/main/agent.yaml -- silently polluting the repo/install
// directory with whatever provider was set first (see dashboard.contract.test.ts's
// "updates main provider with a selected model without restart" test, which
// tripped this on a real user's VPS install).
const dirs = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return {
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-project-root-')),
    claudeclawConfig: fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-external-config-')),
  };
});

vi.mock('./config.js', () => ({
  STORE_DIR: path.join(dirs.projectRoot, 'store'),
  DEFAULT_CLAUDE_MODEL: 'claude-opus-4-8',
  CLAUDECLAW_CONFIG: dirs.claudeclawConfig,
  getClaudeclawConfig: () => dirs.claudeclawConfig,
  PROJECT_ROOT: dirs.projectRoot,
}));

import { getMainProviderConfig, setMainProviderConfig } from './provider.js';

const repoAgentYaml = path.join(dirs.projectRoot, 'agents', 'main', 'agent.yaml');
const externalAgentYaml = path.join(dirs.claudeclawConfig, 'agents', 'main', 'agent.yaml');

describe('main provider persistence — fresh install', () => {
  beforeEach(() => {
    fs.rmSync(path.dirname(repoAgentYaml), { recursive: true, force: true });
    fs.rmSync(path.dirname(externalAgentYaml), { recursive: true, force: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writes a fresh main agent.yaml under CLAUDECLAW_CONFIG, not PROJECT_ROOT', () => {
    setMainProviderConfig({ type: 'acp-codex', model: 'gpt-5.3-codex' });

    expect(fs.existsSync(externalAgentYaml)).toBe(true);
    expect(fs.existsSync(repoAgentYaml)).toBe(false);
  });

  it('reads back the provider it just persisted', () => {
    setMainProviderConfig({ type: 'acp-codex', model: 'gpt-5.3-codex' });

    expect(getMainProviderConfig()).toEqual({ type: 'acp-codex', model: 'gpt-5.3-codex' });
  });

  // Regression for the setup-wizard name prompt: the wizard seeds a chosen
  // display name into agent.yaml, then configureProvider() persists a provider
  // block into the SAME file. That write must preserve the seeded name (not
  // reset it to "Main"), otherwise the name prompt is effectively a no-op.
  it('preserves a pre-seeded display name when the provider is persisted', () => {
    fs.mkdirSync(path.dirname(externalAgentYaml), { recursive: true });
    fs.writeFileSync(externalAgentYaml, 'name: Holden\n', 'utf-8');

    setMainProviderConfig({ type: 'acp-codex', model: 'gpt-5.3-codex' });

    const raw = fs.readFileSync(externalAgentYaml, 'utf-8');
    expect(raw).toMatch(/name:\s*Holden/);
    expect(getMainProviderConfig()).toEqual({ type: 'acp-codex', model: 'gpt-5.3-codex' });
  });
});
