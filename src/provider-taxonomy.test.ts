// Provider taxonomy: `openai` is the STABLE native provider driving the Codex
// runtime; `acp-codex` is the EXPERIMENTAL Codex-over-ACP provider. `acp-codex`
// was spelled `codex` before the native provider existed, so persisted configs
// still carry the old id and must migrate forward on read.
//
// This suite pins the normalization boundary itself (normalizeProviderType /
// normalizeProviderConfig and the persistence readers built on them) and the
// fact that the two Codex routes stay distinct downstream. The dashboard/API
// write boundary is covered in dashboard.contract.test.ts.

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';

const dirs = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return {
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-taxonomy-root-')),
    claudeclawConfig: fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-taxonomy-config-')),
  };
});

vi.mock('./config.js', () => ({
  STORE_DIR: path.join(dirs.projectRoot, 'store'),
  DEFAULT_CLAUDE_MODEL: 'claude-opus-4-8',
  DEFAULT_OPENAI_MODEL: 'gpt-5.5',
  CLAUDECLAW_CONFIG: dirs.claudeclawConfig,
  getClaudeclawConfig: () => dirs.claudeclawConfig,
  PROJECT_ROOT: dirs.projectRoot,
  // Experimental tier ON so acp-codex is runnable/selectable here; the gate
  // itself is covered by enable-acp-gate.test.ts.
  ENABLE_ACP: true,
  agentProvider: undefined,
  agentCwd: undefined,
}));

import {
  DEFAULT_CODEX_MODEL,
  decodeProviderSession,
  encodeProviderSession,
  getMainProviderConfig,
  sessionBelongsToProvider,
  normalizeProviderConfig,
  normalizeProviderType,
  providerToYaml,
  readProviderFromYaml,
  setMainProviderConfig,
  type ProviderConfig,
  type ProviderType,
} from './provider.js';
import { PROVIDER_REGISTRY, providerDescriptor, selectableProviders } from './provider-registry.js';
import { defaultModelForProvider } from './active-provider.js';
import { getAcpCommand } from './agent-engine/acp-adapter.js';

const storeDir = path.join(dirs.projectRoot, 'store');
const mainConfigJson = path.join(storeDir, 'main-config.json');
const externalAgentYaml = path.join(dirs.claudeclawConfig, 'agents', 'main', 'agent.yaml');
const repoAgentYaml = path.join(dirs.projectRoot, 'agents', 'main', 'agent.yaml');

function readYaml(p: string): Record<string, unknown> {
  return yaml.load(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

describe('normalizeProviderType — the single legacy boundary', () => {
  it('migrates the legacy codex id to acp-codex', () => {
    expect(normalizeProviderType('codex')).toBe('acp-codex');
    expect(normalizeProviderType('CODEX')).toBe('acp-codex');
    expect(normalizeProviderType('  codex  ')).toBe('acp-codex');
  });

  it('leaves acp-codex unchanged', () => {
    expect(normalizeProviderType('acp-codex')).toBe('acp-codex');
    expect(normalizeProviderType('ACP-Codex')).toBe('acp-codex');
  });

  it('leaves openai unchanged — the stable native provider keeps its id', () => {
    expect(normalizeProviderType('openai')).toBe('openai');
  });

  it('passes every other known id through and rejects unknown ones', () => {
    for (const t of ['claude', 'acp', 'opencode', 'gemini', 'openrouter'] as ProviderType[]) {
      expect(normalizeProviderType(t)).toBe(t);
    }
    expect(normalizeProviderType('codex-acp')).toBeUndefined(); // the adapter binary, not a provider id
    expect(normalizeProviderType('nope')).toBeUndefined();
    expect(normalizeProviderType(undefined)).toBeUndefined();
    expect(normalizeProviderType(42)).toBeUndefined();
  });
});

describe('normalizeProviderConfig — persisted configs migrate, others are untouched', () => {
  it('reads a legacy codex config as acp-codex, preserving its settings', () => {
    expect(normalizeProviderConfig({ type: 'codex', model: 'gpt-5.3-codex', thinkingMode: 'high' }))
      .toEqual({ type: 'acp-codex', model: 'gpt-5.3-codex', thinkingMode: 'high' });
  });

  it('reads an acp-codex config unchanged', () => {
    expect(normalizeProviderConfig({ type: 'acp-codex', model: 'gpt-5.5' }))
      .toEqual({ type: 'acp-codex', model: 'gpt-5.5' });
  });

  it('reads an openai config unchanged', () => {
    expect(normalizeProviderConfig({ type: 'openai', model: 'gpt-5.5' }))
      .toEqual({ type: 'openai', model: 'gpt-5.5' });
  });

  it('never emits the legacy id on the way back out', () => {
    const migrated = normalizeProviderConfig({ type: 'codex' });
    expect(migrated.type).toBe('acp-codex');
    expect(providerToYaml(migrated)).toEqual({ type: 'acp-codex' });
  });

  it('migrates a legacy provider block read from an agent yaml', () => {
    expect(readProviderFromYaml({ name: 'X', provider: { type: 'codex' } }))
      .toEqual({ type: 'acp-codex' });
  });
});

describe('main provider persistence migrates the legacy id forward', () => {
  beforeEach(() => {
    fs.rmSync(path.dirname(repoAgentYaml), { recursive: true, force: true });
    fs.rmSync(path.dirname(externalAgentYaml), { recursive: true, force: true });
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reads a pre-rename agent.yaml provider block as acp-codex', () => {
    fs.mkdirSync(path.dirname(externalAgentYaml), { recursive: true });
    fs.writeFileSync(
      externalAgentYaml,
      yaml.dump({ name: 'Main', provider: { type: 'codex', model: 'gpt-5.3-codex' } }),
      'utf-8',
    );

    expect(getMainProviderConfig()).toEqual({ type: 'acp-codex', model: 'gpt-5.3-codex' });
  });

  it('migrates a pre-rename main-config.json provider into agent.yaml as acp-codex', () => {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(mainConfigJson, JSON.stringify({ provider: { type: 'codex' } }) + '\n', 'utf-8');

    expect(getMainProviderConfig()).toEqual({ type: 'acp-codex' });
    // The one-time migration into agent.yaml writes the canonical id, so the
    // legacy spelling does not survive the round trip.
    expect(readYaml(externalAgentYaml).provider).toEqual({ type: 'acp-codex' });
    expect(JSON.parse(fs.readFileSync(mainConfigJson, 'utf-8')).provider).toBeUndefined();
  });

  it('persists and reads back acp-codex unchanged', () => {
    setMainProviderConfig({ type: 'acp-codex', model: 'gpt-5.5' });
    expect(readYaml(externalAgentYaml).provider).toEqual({ type: 'acp-codex', model: 'gpt-5.5' });
    expect(getMainProviderConfig()).toEqual({ type: 'acp-codex', model: 'gpt-5.5' });
  });

  it('persists and reads back openai unchanged', () => {
    setMainProviderConfig({ type: 'openai', model: 'gpt-5.4' });
    expect(readYaml(externalAgentYaml).provider).toEqual({ type: 'openai', model: 'gpt-5.4' });
    expect(getMainProviderConfig()).toEqual({ type: 'openai', model: 'gpt-5.4' });
  });
});

describe('the taxonomy keeps native openai and ACP Codex distinct', () => {
  it('codex is not a selectable provider — only acp-codex is', () => {
    expect(PROVIDER_REGISTRY).not.toHaveProperty('codex');
    expect(PROVIDER_REGISTRY['acp-codex']).toMatchObject({ tier: 'experimental', enablement: 'acp-beta' });
    const types = selectableProviders().map((p) => p.type);
    expect(types).toContain('acp-codex');
    expect(types).toContain('openai');
    expect(types).not.toContain('codex');
  });

  it('grades openai stable and acp-codex experimental', () => {
    expect(providerDescriptor('openai')).toMatchObject({ tier: 'stable', enablement: 'auth' });
    expect(providerDescriptor('acp-codex')).toMatchObject({ tier: 'experimental', label: 'Codex (ACP)' });
  });

  it('resolves different default models for the two Codex routes', () => {
    expect(defaultModelForProvider({ type: 'openai' })).toBe('gpt-5.5');
    expect(defaultModelForProvider({ type: 'acp-codex' })).toBe(DEFAULT_CODEX_MODEL);
  });

  it('only acp-codex maps to the codex-acp ACP command', () => {
    expect(getAcpCommand({ type: 'acp-codex' })).toEqual({ command: 'codex-acp', args: [] });
    // openai never reaches the ACP adapter, so it has no ACP preset — it falls
    // through to the custom-command branch and rejects for want of a command.
    expect(() => getAcpCommand({ type: 'openai' })).toThrow(/requires a command/);
  });

  it('namespaces sessions per route, so a migrated config cannot adopt an openai thread', () => {
    const openaiSession = encodeProviderSession({ type: 'openai' }, 'thread-1');
    expect(openaiSession).toBe('openai:thread-1');
    const migrated = normalizeProviderConfig({ type: 'codex' });
    expect(sessionBelongsToProvider(openaiSession, migrated)).toBe(false);
    expect(decodeProviderSession(migrated, openaiSession)).toBeUndefined();
  });
});

// Sessions are stored namespaced `<providerType>:<id>`. Renaming the provider
// would otherwise orphan every thread saved as `codex:<id>` — the turn would
// silently start over instead of resuming. Reads accept the legacy prefix;
// writes stay canonical so the old spelling decays as threads roll over.
describe('legacy ACP Codex sessions stay resumable', () => {
  const acpCodex: ProviderConfig = { type: 'acp-codex' };

  it('a legacy codex: session belongs to acp-codex', () => {
    expect(sessionBelongsToProvider('codex:abc', acpCodex)).toBe(true);
  });

  it('a legacy codex: session decodes to the underlying id', () => {
    expect(decodeProviderSession(acpCodex, 'codex:abc')).toBe('abc');
  });

  it('the canonical prefix still resolves', () => {
    expect(sessionBelongsToProvider('acp-codex:abc', acpCodex)).toBe(true);
    expect(decodeProviderSession(acpCodex, 'acp-codex:abc')).toBe('abc');
  });

  it('the legacy prefix is offered to acp-codex and to NO other provider', () => {
    for (const type of ['openai', 'claude', 'gemini', 'opencode', 'openrouter', 'acp'] as ProviderType[]) {
      expect(sessionBelongsToProvider('codex:abc', { type })).toBe(false);
      expect(decodeProviderSession({ type }, 'codex:abc')).toBeUndefined();
    }
  });

  it('new sessions are written with the canonical prefix only', () => {
    expect(encodeProviderSession(acpCodex, 'abc')).toBe('acp-codex:abc');
    // Re-encoding a resumed legacy thread converges on the canonical form, so
    // the old prefix is never rewritten back to disk.
    const recovered = decodeProviderSession(acpCodex, 'codex:abc');
    expect(encodeProviderSession(acpCodex, recovered)).toBe('acp-codex:abc');
  });

  it('does not confuse an id that merely starts with the legacy word', () => {
    // `codexish:` is a different namespace, not the legacy `codex:` prefix.
    expect(sessionBelongsToProvider('codexish:abc', acpCodex)).toBe(false);
    expect(decodeProviderSession(acpCodex, 'codexish:abc')).toBeUndefined();
  });

  // The agent, voice, and War Room paths all resume through the SAME two-call
  // boundary. Pinning the composition here covers all three; the drift guard
  // below keeps them on it.
  const resumeThroughSharedBoundary = (
    stored: string | undefined,
    provider: ProviderConfig,
  ): string | undefined => (
    sessionBelongsToProvider(stored, provider) ? decodeProviderSession(provider, stored) : undefined
  );

  it('the shared resume boundary recovers a legacy session for acp-codex', () => {
    expect(resumeThroughSharedBoundary('codex:abc', acpCodex)).toBe('abc');
    expect(resumeThroughSharedBoundary('acp-codex:abc', acpCodex)).toBe('abc');
    // A native OpenAI turn must still start fresh rather than adopt the thread.
    expect(resumeThroughSharedBoundary('codex:abc', { type: 'openai' })).toBeUndefined();
  });

  it('agent, voice, and War Room consumers all resume through that boundary', () => {
    for (const file of ['agent.ts', 'agent-voice-bridge.ts', 'warroom-text-orchestrator.ts']) {
      const source = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf-8');
      // No consumer may re-derive the prefix itself — that is what would strand
      // legacy sessions on a rename.
      expect(source, `${file} must resume via sessionBelongsToProvider`).toContain('sessionBelongsToProvider(sessionId, provider)');
      expect(source, `${file} must decode via decodeProviderSession`).toContain('decodeProviderSession(provider, sessionId)');
      expect(source, `${file} must not hand-roll a provider session prefix`).not.toMatch(/startsWith\(`\$\{provider\.type\}:/);
    }
  });
});
