import path from 'path';
import { fileURLToPath } from 'url';
import { quoteWindowsClaudeclawConfig } from '../../src/env-migration.js';

export const description =
  'Quote existing Windows CLAUDECLAW_CONFIG paths so shell and Node readers agree';

export async function run(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const envFile = path.join(projectRoot, '.env');
  const result = quoteWindowsClaudeclawConfig(envFile);

  if (result === 'updated') {
    console.log('    Quoted CLAUDECLAW_CONFIG in .env (backup: .env.pre-v1.8.0.bak)');
  } else if (result === 'missing') {
    console.log('    No .env found; nothing to migrate');
  } else {
    console.log('    CLAUDECLAW_CONFIG already quote-safe or not a Windows path');
  }
}

