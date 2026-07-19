import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

import { renderCliReference, renderCliIndex, normalizeEol } from './cli-reference.js';
import { allDescriptors } from './cli-descriptors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const DOC_PATH = path.join(PROJECT_ROOT, 'docs', 'agent-cli-reference.md');

describe('cli-reference drift guard', () => {
  it('the committed docs/agent-cli-reference.md matches the generated output', () => {
    // If this fails, a descriptor changed but the doc was not regenerated.
    // Fix by running `npm run gen:cli-docs` and committing the result.
    // Line endings are normalized so git's autocrlf (CRLF on Windows checkout)
    // does not produce false drift — content is what the guard protects.
    const onDisk = normalizeEol(fs.readFileSync(DOC_PATH, 'utf-8'));
    const generated = normalizeEol(renderCliReference(allDescriptors));
    expect(onDisk, 'docs/agent-cli-reference.md is stale — run `npm run gen:cli-docs`').toBe(
      generated,
    );
  });
});

describe('cli-reference coverage guard', () => {
  // Every shipped CLI (src/*-cli.ts) MUST have a matching entry in
  // allDescriptors. This is what catches a future CLI shipped without docs —
  // the exact drift that let mission-cli ship undocumented and unused
  // fleet-wide.
  const cliFiles = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('-cli.ts') && !f.endsWith('.test.ts'))
    .sort();

  it('finds the shipped CLI source files', () => {
    expect(cliFiles.length).toBeGreaterThan(0);
  });

  for (const file of cliFiles) {
    // e.g. `mission-cli.ts` -> descriptor name `mission-cli`.
    const expectedName = file.replace(/\.ts$/, '');
    it(`${file} has a matching descriptor in allDescriptors`, () => {
      const match = allDescriptors.find((d) => d.name === expectedName);
      expect(
        match,
        `${file} has no entry in src/cli-descriptors.ts (allDescriptors). ` +
          `Export a \`descriptor: CliDescriptor\` from it and register it there.`,
      ).toBeDefined();
    });
  }
});

describe('renderCliIndex (prompt injection)', () => {
  const index = renderCliIndex(allDescriptors);

  it('names every ship=true descriptor so the injected index cannot silently drop a CLI', () => {
    for (const d of allDescriptors.filter((d) => d.ship)) {
      expect(index, `renderCliIndex must list ${d.name}`).toContain(d.name);
    }
  });

  it('names both mission-cli and schedule-cli (the one-shot vs recurring routing pair)', () => {
    expect(index).toContain('mission-cli');
    expect(index).toContain('schedule-cli');
  });

  it('gives the runnable node invocation and forbids raw sqlite3 (issue #155 scope A/B)', () => {
    // Agents were falling back to raw sqlite3 because they tried the bare command
    // name (not on PATH). The index must show the node dist form and ban raw sqlite3.
    expect(index).toContain('node "$PROJECT_ROOT/');
    expect(index.toLowerCase()).toContain('raw sqlite3');
    expect(index).toContain('dist/hive-cli.js');
  });
});
