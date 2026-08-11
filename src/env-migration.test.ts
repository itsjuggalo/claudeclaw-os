import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quoteWindowsClaudeclawConfig } from './env-migration.js';

describe('quoteWindowsClaudeclawConfig', () => {
  let dir: string;
  let envFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-env-migration-'));
    envFile = path.join(dir, '.env');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('quotes an unquoted Windows path and preserves a recoverable backup', () => {
    const original = [
      '# existing install',
      'TELEGRAM_BOT_TOKEN=secret',
      'CLAUDECLAW_CONFIG=C:\\Users\\mike\\.claudeclaw-os',
      '',
    ].join('\n');
    fs.writeFileSync(envFile, original);

    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('updated');
    expect(fs.readFileSync(envFile, 'utf8')).toContain(
      "CLAUDECLAW_CONFIG='C:\\Users\\mike\\.claudeclaw-os'",
    );
    expect(fs.readFileSync(`${envFile}.pre-v1.8.0.bak`, 'utf8')).toBe(original);
  });

  it('uses double quotes when the Windows path contains an apostrophe', () => {
    fs.writeFileSync(envFile, "CLAUDECLAW_CONFIG=C:\\Users\\O'Brien\\.claudeclaw\n");

    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('updated');
    expect(fs.readFileSync(envFile, 'utf8')).toBe(
      "CLAUDECLAW_CONFIG=\"C:\\Users\\O'Brien\\.claudeclaw\"\n",
    );
  });

  it('quotes an unquoted UNC path', () => {
    fs.writeFileSync(envFile, 'CLAUDECLAW_CONFIG=\\\\server\\share\\claudeclaw\n');

    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('updated');
    expect(fs.readFileSync(envFile, 'utf8')).toBe(
      "CLAUDECLAW_CONFIG='\\\\server\\share\\claudeclaw'\n",
    );
  });

  it.each([
    "CLAUDECLAW_CONFIG='C:\\Users\\mike\\.claudeclaw'\n",
    'CLAUDECLAW_CONFIG="C:\\Users\\mike\\.claudeclaw"\n',
    'CLAUDECLAW_CONFIG=~/.claudeclaw\n',
    'CLAUDECLAW_CONFIG=/srv/claudeclaw\n',
  ])('leaves an already-safe value unchanged: %s', (content) => {
    fs.writeFileSync(envFile, content);

    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('unchanged');
    expect(fs.readFileSync(envFile, 'utf8')).toBe(content);
    expect(fs.existsSync(`${envFile}.pre-v1.8.0.bak`)).toBe(false);
  });

  it('is idempotent and does not replace the original backup', () => {
    const original = 'CLAUDECLAW_CONFIG=C:\\Users\\mike\\.claudeclaw\n';
    fs.writeFileSync(envFile, original);

    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('updated');
    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('unchanged');
    expect(fs.readFileSync(`${envFile}.pre-v1.8.0.bak`, 'utf8')).toBe(original);
  });

  it('does nothing when .env is absent', () => {
    expect(quoteWindowsClaudeclawConfig(envFile)).toBe('missing');
  });
});

