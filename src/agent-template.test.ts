import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { applyProviderToAgentYamlTemplate } from './agent-template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

describe('agent install templates', () => {
  it('keeps the main persona free of provider, capability, path, and telemetry guesses', () => {
    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, 'CLAUDE.md.example'),
      'utf-8',
    );

    expect(source).toContain('injected for the current turn as authoritative');
    expect(source).toContain('Provider, model, reasoning, thinking, and permission settings belong in `agent.yaml` and runtime state.');
    expect(source).toContain('hive-cli path');
    expect(source).toContain('Do not derive context occupancy from cumulative token or pricing records.');
    expect(source).not.toContain('[CONFIG_DIR]');
    expect(source).not.toContain('[STORE_PATH]');
    expect(source).not.toContain('git rev-parse');
    expect(source).not.toContain('~/.claude/skills');
    expect(source).not.toContain('Use /model');
    expect(source).not.toMatch(/claude-(?:opus|sonnet|haiku)-/i);
    expect(source).not.toMatch(/gpt-\d/i);
  });

  it('keeps the blank specialist persona on the same runtime boundary', () => {
    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, 'agents', '_template', 'CLAUDE.md'),
      'utf-8',
    );

    expect(source).toContain('injected for the current turn as authoritative');
    expect(source).toContain('Provider, model, reasoning, thinking, permission, and connector settings belong in `agent.yaml` and runtime state.');
    expect(source).toContain('Never rely on a stamped or remembered filesystem path.');
    expect(source).not.toContain('Use /model');
    expect(source).not.toContain('~/.claude/skills');
  });

  it('injects the selected provider without dropping unrelated template guidance', () => {
    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, 'agents', '_template', 'agent.yaml.example'),
      'utf-8',
    );

    const rendered = applyProviderToAgentYamlTemplate(source, {
      type: 'openai',
      model: 'gpt-test',
      thinkingMode: 'high',
    });
    const parsed = yaml.load(rendered) as Record<string, unknown>;

    expect(parsed.provider).toEqual({
      type: 'openai',
      model: 'gpt-test',
      thinkingMode: 'high',
    });
    expect(rendered).toContain('# MCP server allowlist (optional).');
    expect(rendered).toContain('# Obsidian integration (optional).');
    expect(rendered).not.toContain('type: claude');
  });

  it('fails closed when a template has no explicit provider boundary', () => {
    expect(() => applyProviderToAgentYamlTemplate(
      'name: Missing Provider\n',
      { type: 'openai' },
    )).toThrow(/no active provider block/);
  });
});
