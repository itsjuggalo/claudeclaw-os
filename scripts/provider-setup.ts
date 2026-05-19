#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';

import {
  setMainProviderConfig,
  providerToYaml,
  type ProviderConfig,
} from '../src/provider.js';
import { listAgentIds, resolveAgentDir } from '../src/agent-config.js';
import yaml from 'js-yaml';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function ask(question: string, defaultVal?: string): Promise<string> {
  return new Promise((resolve) => {
    const hint = defaultVal ? ` (${defaultVal})` : '';
    rl.question(`${question}${hint} › `, (ans) => resolve(ans.trim() || defaultVal || ''));
  });
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const ans = (await ask(`${question} [${defaultYes ? 'Y/n' : 'y/N'}]`)).toLowerCase();
  if (!ans) return defaultYes;
  return ans === 'y' || ans === 'yes';
}

function commandExists(command: string): boolean {
  const check = process.platform === 'win32' ? ['where', command] : ['which', command];
  return spawnSync(check[0], [check[1]], { stdio: 'pipe' }).status === 0;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function getOpenCodeCredentialCount(): number | null {
  const result = spawnSync('opencode', ['providers', 'list'], { stdio: 'pipe', encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  const match = output.match(/(\d+)\s+credentials?/i);
  if (match) return parseInt(match[1], 10);
  return output.toLowerCase().includes('credentials') ? 0 : null;
}

function getOpenCodeModels(): string[] {
  const result = spawnSync('opencode', ['models'], { stdio: 'pipe', encoding: 'utf-8' });
  if (result.status !== 0) return [];
  return stripAnsi(result.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(line));
}

async function selectOpenCodeModel(): Promise<string | null> {
  const models = getOpenCodeModels();
  if (models.length === 0) {
    console.warn('Could not load OpenCode models. You can still enter a model id manually.');
    const manual = await ask('OpenCode default model (provider/model, or Enter to keep current)');
    return manual || null;
  }

  console.log('Available OpenCode models:');
  console.log();
  models.forEach((model, idx) => {
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. ${model}`);
  });
  console.log();
  console.log('Press Enter to keep OpenCode\'s current default model.');
  const answer = await ask('Select model number, or type a model id');
  if (!answer) return null;

  const numeric = parseInt(answer, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= models.length) {
    return models[numeric - 1];
  }
  if (/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(answer)) return answer;

  console.warn(`Unknown model selection "${answer}". Keeping OpenCode's current default model.`);
  return null;
}

function updateOpenCodeDefaultModel(model: string): void {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.jsonc');
  fs.mkdirSync(configDir, { recursive: true });
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      raw = JSON.parse(content) as Record<string, unknown>;
    } catch {
      console.warn(`Could not parse ${configPath}; writing a clean config.`);
    }
  }
  raw.model = model;
  fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}

function setAgentProviderYaml(agentId: string, provider: ProviderConfig): void {
  const configPath = path.join(resolveAgentDir(agentId), 'agent.yaml');
  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  raw.provider = providerToYaml(provider);
  delete raw.model;
  fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), 'utf-8');
}

async function selectProvider(): Promise<ProviderConfig> {
  console.log('Providers:');
  console.log('  1. Claude (default)');
  console.log('  2. OpenCode');
  console.log('  3. Gemini CLI');
  console.log('  4. Codex ACP adapter');
  console.log('  5. Custom ACP command');
  console.log();

  const answer = (await ask('Select provider', '1')).toLowerCase();
  if (answer === '2' || answer === 'opencode' || answer === 'o') return { type: 'opencode' };
  if (answer === '3' || answer === 'gemini' || answer === 'g') return { type: 'gemini' };
  if (answer === '4' || answer === 'codex') return { type: 'codex' };
  if (answer === '5' || answer === 'acp' || answer === 'custom') {
    const command = await ask('ACP command');
    if (!command) throw new Error('Custom ACP provider requires a command.');
    const args = splitArgs(await ask('ACP arguments', '--acp'));
    return { type: 'acp', command, args };
  }
  if (answer !== '1' && answer !== 'claude' && answer !== 'c') {
    console.warn(`Unknown provider "${answer}". Using Claude.`);
  }
  return { type: 'claude', model: await ask('Claude model', 'claude-opus-4-6') };
}

function splitArgs(input: string): string[] {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

async function main(): Promise<void> {
  const agents = ['main', ...listAgentIds().filter((id) => id !== 'main')];
  console.log(`Agents: ${agents.join(', ')}`);
  const target = await ask('Configure which agent? Use "all" for every agent', 'main');

  const provider = await selectProvider();

  if (provider.type === 'opencode') {
    if (!commandExists('opencode')) {
      throw new Error('OpenCode CLI not found. Install it, then re-run npm run provider:setup.');
    }
    const credentialCount = getOpenCodeCredentialCount();
    if (credentialCount && credentialCount > 0) {
      console.log(`OpenCode auth found (${credentialCount} credential${credentialCount === 1 ? '' : 's'}).`);
      console.log('OpenCode lists model provider credentials here, not an "OpenCode" account.');
    } else if (await confirm('Run OpenCode auth login now?', false)) {
      spawnSync('opencode', ['auth', 'login'], { stdio: 'inherit' });
    }
    if (await confirm('Choose an OpenCode model now?', false)) {
      const model = await selectOpenCodeModel();
      if (model) {
        updateOpenCodeDefaultModel(model);
        console.log(`OpenCode default model set to ${model}`);
      } else {
        console.log('Keeping OpenCode current default model.');
      }
    } else {
      console.log('Keeping OpenCode current default model.');
    }
  } else if (provider.type === 'gemini') {
    if (!commandExists('gemini')) {
      throw new Error('Gemini CLI not found. Install and authenticate Gemini CLI, then re-run npm run provider:setup.');
    }
    console.log('Gemini CLI found. Auth and model selection stay in Gemini CLI.');
  } else if (provider.type === 'codex') {
    if (!commandExists('codex-acp')) {
      throw new Error('codex-acp adapter not found. Install and authenticate the Codex ACP adapter, then re-run npm run provider:setup.');
    }
    console.log('codex-acp adapter found. Auth and model selection stay in the adapter/Codex config.');
  } else if (provider.type === 'acp') {
    if (!provider.command) throw new Error('Custom ACP provider requires a command.');
    if (!commandExists(provider.command)) {
      console.warn(`Command "${provider.command}" was not found on PATH right now.`);
    }
  }

  const targets = target === 'all' ? agents : [target];
  for (const id of targets) {
    if (id === 'main') setMainProviderConfig(provider);
    else setAgentProviderYaml(id, provider);
    console.log(`Updated ${id}: ${provider.type}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
