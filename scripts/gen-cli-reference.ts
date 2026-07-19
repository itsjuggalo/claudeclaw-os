#!/usr/bin/env tsx
/**
 * Generate docs/agent-cli-reference.md from each shipped CLI's exported
 * `descriptor`. This is the single source of truth for agent-facing CLI docs —
 * hand-editing the doc is a bug (a vitest drift guard fails if it diverges).
 *
 *   npm run gen:cli-docs        Regenerate and write the doc.
 *   npm run gen:cli-docs:check  Compare the doc to the descriptors; exit 1 if
 *                               they differ (used in CI / by the test suite).
 *
 * To document a new CLI: export a `descriptor: CliDescriptor` from it and add
 * the import below. The coverage guard test (src/cli-reference.test.ts) fails
 * if a src/*-cli.ts file is missing a descriptor, so nothing ships undocumented.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { renderCliReference, normalizeEol } from '../src/cli-reference.js';
import { allDescriptors } from '../src/cli-descriptors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(PROJECT_ROOT, 'docs', 'agent-cli-reference.md');

async function main(): Promise<void> {
  const generated = renderCliReference(allDescriptors);
  const check = process.argv.includes('--check');

  if (check) {
    const onDisk = fs.existsSync(DOC_PATH)
      ? normalizeEol(fs.readFileSync(DOC_PATH, 'utf-8'))
      : null;
    if (onDisk === normalizeEol(generated)) {
      console.log(`OK: ${path.relative(PROJECT_ROOT, DOC_PATH)} is up to date.`);
      process.exit(0);
    }
    console.error(
      `DRIFT: ${path.relative(PROJECT_ROOT, DOC_PATH)} is out of date. ` +
        `Run \`npm run gen:cli-docs\` to regenerate.`,
    );
    if (onDisk === null) {
      console.error('  (the doc file does not exist yet)');
    } else {
      const genLines = normalizeEol(generated).split('\n');
      const diskLines = onDisk.split('\n');
      const max = Math.max(genLines.length, diskLines.length);
      let shown = 0;
      for (let i = 0; i < max && shown < 20; i++) {
        if (genLines[i] !== diskLines[i]) {
          console.error(`  line ${i + 1}:`);
          console.error(`    on-disk:   ${JSON.stringify(diskLines[i] ?? '<missing>')}`);
          console.error(`    generated: ${JSON.stringify(genLines[i] ?? '<missing>')}`);
          shown++;
        }
      }
    }
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, generated, 'utf-8');
  console.log(`Wrote ${path.relative(PROJECT_ROOT, DOC_PATH)}`);
}

// Only run when invoked directly. Guard against process.argv[1] being undefined.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void main();
}
