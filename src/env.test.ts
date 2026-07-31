import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readEnvFile, envFileCandidates, REPO_ROOT_ENV } from './env.js';

const TMP_DIR = '/tmp/claudeclaw-env-test';
const TMP_ENV = path.join(TMP_DIR, '.env');

function writeEnv(content: string): void {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(TMP_ENV, content, 'utf-8');
}

function cleanup(): void {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('readEnvFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function mockCwd(): void {
    vi.spyOn(process, 'cwd').mockReturnValue(TMP_DIR);
  }

  it('parses KEY=value correctly', () => {
    writeEnv('FOO=bar\nBAZ=qux\n');
    mockCwd();
    const result = readEnvFile(['FOO', 'BAZ']);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles double-quoted values', () => {
    writeEnv('GREETING="hello world"\n');
    mockCwd();
    const result = readEnvFile(['GREETING']);
    expect(result).toEqual({ GREETING: 'hello world' });
  });

  it('handles single-quoted values', () => {
    writeEnv("NAME='John Doe'\n");
    mockCwd();
    const result = readEnvFile(['NAME']);
    expect(result).toEqual({ NAME: 'John Doe' });
  });

  it('ignores comment lines', () => {
    writeEnv('# This is a comment\nKEY=value\n# Another comment\n');
    mockCwd();
    const result = readEnvFile(['KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('ignores blank lines', () => {
    writeEnv('\n\nKEY=value\n\n\n');
    mockCwd();
    const result = readEnvFile(['KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('returns empty object if .env does not exist', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/nonexistent-dir-xyz');
    const result = readEnvFile(['FOO']);
    expect(result).toEqual({});
  });

  it('derives the canonical fallback from the module location', () => {
    const expected = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '.env',
    );
    expect(REPO_ROOT_ENV).toBe(expected);
    expect(envFileCandidates('/tmp/non-repo-agent')).toEqual([
      path.resolve('/tmp/non-repo-agent', '.env'),
      expected,
    ]);
  });

  it('falls back to the repo-root .env when invoked from a non-repo cwd', () => {
    const agentCwd = path.resolve('/tmp/non-repo-agent');
    const agentEnv = path.join(agentCwd, '.env');
    vi.spyOn(process, 'cwd').mockReturnValue(agentCwd);
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, encoding) => {
      const resolved = path.resolve(String(file));
      if (resolved === agentEnv) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      if (resolved === REPO_ROOT_ENV && encoding === 'utf-8') {
        return 'DB_ENCRYPTION_KEY=repo-root-secret\nCLAUDECLAW_CONFIG="C:\\Users\\O\'Brien\\.claudeclaw"\n';
      }
      throw Object.assign(new Error(`unexpected read: ${resolved}`), { code: 'ENOENT' });
    });

    expect(readEnvFile(['DB_ENCRYPTION_KEY', 'CLAUDECLAW_CONFIG'])).toEqual({
      DB_ENCRYPTION_KEY: 'repo-root-secret',
      CLAUDECLAW_CONFIG: "C:\\Users\\O'Brien\\.claudeclaw",
    });
  });

  it('keeps a cwd-local .env authoritative when one exists', () => {
    writeEnv('DB_ENCRYPTION_KEY=local-override\n');
    mockCwd();
    expect(readEnvFile(['DB_ENCRYPTION_KEY'])).toEqual({
      DB_ENCRYPTION_KEY: 'local-override',
    });
  });

  it('only returns requested keys', () => {
    writeEnv('A=1\nB=2\nC=3\n');
    mockCwd();
    const result = readEnvFile(['A', 'C']);
    expect(result).toEqual({ A: '1', C: '3' });
    expect(result).not.toHaveProperty('B');
  });

  it('strips surrounding whitespace from keys and values', () => {
    writeEnv('  MY_KEY  =  my_value  \n');
    mockCwd();
    const result = readEnvFile(['MY_KEY']);
    expect(result).toEqual({ MY_KEY: 'my_value' });
  });

  it('handles values containing = sign', () => {
    writeEnv('URL=https://example.com?a=1&b=2\n');
    mockCwd();
    const result = readEnvFile(['URL']);
    expect(result).toEqual({ URL: 'https://example.com?a=1&b=2' });
  });

  it('skips lines without = sign', () => {
    writeEnv('NOEQUALS\nKEY=value\n');
    mockCwd();
    const result = readEnvFile(['KEY', 'NOEQUALS']);
    expect(result).toEqual({ KEY: 'value' });
  });

  // Quote-safe Windows paths: single-quoting a value must strip exactly one quote
  // layer and leave backslashes literal, so the same .env line works for the Node
  // parser, for shell grep|cut readers, and for a raw `source .env`.
  it('preserves backslashes in a single-quoted Windows path (strips quotes only)', () => {
    writeEnv("CLAUDECLAW_CONFIG='C:\\Users\\mikek\\.claudeclaw-os'\n");
    mockCwd();
    const result = readEnvFile(['CLAUDECLAW_CONFIG']);
    expect(result).toEqual({ CLAUDECLAW_CONFIG: 'C:\\Users\\mikek\\.claudeclaw-os' });
  });

  it('preserves backslashes in a double-quoted Windows path (strips quotes only)', () => {
    writeEnv('CLAUDECLAW_CONFIG="C:\\Users\\mikek\\.claudeclaw-os"\n');
    mockCwd();
    const result = readEnvFile(['CLAUDECLAW_CONFIG']);
    expect(result).toEqual({ CLAUDECLAW_CONFIG: 'C:\\Users\\mikek\\.claudeclaw-os' });
  });

  it('handles an unquoted Windows path (backslashes intact)', () => {
    writeEnv('CLAUDECLAW_CONFIG=C:\\Users\\mikek\\.claudeclaw-os\n');
    mockCwd();
    const result = readEnvFile(['CLAUDECLAW_CONFIG']);
    expect(result).toEqual({ CLAUDECLAW_CONFIG: 'C:\\Users\\mikek\\.claudeclaw-os' });
  });

  // A path containing an apostrophe (e.g. a Windows user folder like O'Brien) cannot be
  // single-quoted — the literal ' would be invalid shell syntax — so setup.ts writes it
  // double-quoted instead. The Node parser must still strip exactly one quote layer and
  // preserve the interior apostrophe and backslashes.
  it('preserves an apostrophe in a double-quoted Windows path', () => {
    writeEnv('CLAUDECLAW_CONFIG="C:\\Users\\O\'Brien\\.claudeclaw-os"\n');
    mockCwd();
    const result = readEnvFile(['CLAUDECLAW_CONFIG']);
    expect(result).toEqual({ CLAUDECLAW_CONFIG: "C:\\Users\\O'Brien\\.claudeclaw-os" });
  });
});
