import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'agents');

// The shipped specialist seeds. Each must stay in sync with agents/_template
// for the shared operational sections — a seed that drops the file-marker or
// handback section produces an agent that cannot return files or report back
// (the gap Xavier Delzenne found on v1.7.0). This guard fails if a seed rots.
const SEEDS = ['comms', 'content', 'ops', 'research'];

function readSeed(name: string): string {
  return fs.readFileSync(path.join(AGENTS_DIR, name, 'CLAUDE.md'), 'utf-8');
}

describe('specialist seed CLAUDE.md drift guard', () => {
  for (const name of SEEDS) {
    describe(name, () => {
      const body = readSeed(name);

      it('documents the Telegram file markers (the only supported way to return files)', () => {
        expect(body).toContain('[SEND_FILE:');
        expect(body).toContain('[SEND_PHOTO:');
        expect(body).toContain('Do not use direct Telegram API calls');
        expect(body).toContain('@BotFather');
      });

      it('documents the deterministic handback path', () => {
        expect(body).toContain('mission-cli handback');
        expect(body.toLowerCase()).toContain('task originator');
      });

      it('routes the hive mind through hive-cli, not a raw sqlite3 path', () => {
        expect(body).toContain('hive-cli');
        // The raw sqlite3 anti-pattern cannot see a relocated store (issue #155).
        expect(body).not.toMatch(/sqlite3\s+store/);
      });

      it('does not rediscover the project root via git rev-parse (issue #157)', () => {
        expect(body).not.toContain('git rev-parse');
      });

      it('keeps provider and capability state outside the persona', () => {
        expect(body).toContain('Provider, model, reasoning, thinking, permission, and connector settings belong in `agent.yaml` and runtime state.');
        expect(body).toContain('injected for the current turn as authoritative');
        expect(body).not.toContain('Use /model');
        expect(body).not.toContain('~/.claude/skills');
        expect(body).not.toMatch(/claude-(?:opus|sonnet|haiku)-/i);
        expect(body).not.toMatch(/gpt-\d/i);
      });

      it('resolves paths dynamically instead of shipping snapshots', () => {
        expect(body).toContain('CLAUDECLAW_CONFIG');
        expect(body).toContain('hive-cli path');
        expect(body).toContain('Never rely on a stamped or remembered filesystem path.');
        expect(body).not.toContain('Store DB (for reference)');
      });
    });
  }
});
