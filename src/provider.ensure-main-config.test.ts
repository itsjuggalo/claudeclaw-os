import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression test for #148: the runtime must bootstrap main's external
// config (CLAUDECLAW_CONFIG/agents/main/agent.yaml) on boot, independent of
// the interactive setup wizard. Headless/VPS installs skip the wizard, so
// without this the file never existed and reads/writes fell through to
// PROJECT_ROOT — the virgin state behind the config-poisoning class (#146).
//
// ensureMainAgentConfig() must also preserve #147's self-heal: a legacy
// PROJECT_ROOT file (from a pre-#147 install) is migrated forward verbatim,
// never shadowed by an empty stub.
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

import { ensureMainAgentConfig, getMainProviderConfig } from './provider.js';

const repoAgentYaml = path.join(dirs.projectRoot, 'agents', 'main', 'agent.yaml');
const externalAgentYaml = path.join(dirs.claudeclawConfig, 'agents', 'main', 'agent.yaml');

function readYaml(p: string): Record<string, unknown> {
  return (yaml.load(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>) ?? {};
}

describe('ensureMainAgentConfig — runtime config bootstrap', () => {
  beforeEach(() => {
    fs.rmSync(path.dirname(repoAgentYaml), { recursive: true, force: true });
    fs.rmSync(path.dirname(externalAgentYaml), { recursive: true, force: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a minimal external agent.yaml on a truly fresh install', () => {
    ensureMainAgentConfig();

    expect(fs.existsSync(externalAgentYaml)).toBe(true);
    expect(fs.existsSync(repoAgentYaml)).toBe(false);

    const raw = readYaml(externalAgentYaml);
    expect(raw.name).toBe('Main');
    // No provider/model baked in — env/config default must keep applying.
    expect(raw.provider).toBeUndefined();
    expect(raw.model).toBeUndefined();
  });

  it('leaves main resolving to the default provider after a fresh bootstrap', () => {
    ensureMainAgentConfig();
    expect(getMainProviderConfig()).toEqual({ type: 'claude', model: 'claude-opus-4-8' });
  });

  it('migrates a legacy PROJECT_ROOT agent.yaml forward verbatim (preserves its provider)', () => {
    fs.mkdirSync(path.dirname(repoAgentYaml), { recursive: true });
    fs.writeFileSync(
      repoAgentYaml,
      yaml.dump({ name: 'Holden', provider: { type: 'codex', model: 'gpt-5.5' } }),
      'utf-8',
    );

    ensureMainAgentConfig();

    expect(fs.existsSync(externalAgentYaml)).toBe(true);
    const raw = readYaml(externalAgentYaml);
    expect(raw.name).toBe('Holden');
    // Legacy provider carried forward, not shadowed by an empty stub. The
    // pre-rename `codex` id in that file normalizes to acp-codex on read.
    expect(getMainProviderConfig()).toEqual({ type: 'acp-codex', model: 'gpt-5.5' });
  });

  it('is idempotent — never overwrites an existing external agent.yaml', () => {
    fs.mkdirSync(path.dirname(externalAgentYaml), { recursive: true });
    fs.writeFileSync(
      externalAgentYaml,
      yaml.dump({ name: 'Custom', provider: { type: 'gemini' } }),
      'utf-8',
    );

    ensureMainAgentConfig();

    const raw = readYaml(externalAgentYaml);
    expect(raw.name).toBe('Custom');
    expect(getMainProviderConfig()).toEqual({ type: 'gemini' });
  });
});
