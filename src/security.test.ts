import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScrubbedSdkEnv, getOwnSystemdUnit } from './security.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_GETUID = Object.getOwnPropertyDescriptor(process, 'getuid');

function setGetuid(fn: (() => number) | undefined): void {
  if (fn === undefined) {
    delete (process as { getuid?: () => number }).getuid;
  } else {
    (process as { getuid?: () => number }).getuid = fn;
  }
}

function restoreGetuid(): void {
  if (ORIGINAL_GETUID) {
    Object.defineProperty(process, 'getuid', ORIGINAL_GETUID);
  } else {
    delete (process as { getuid?: () => number }).getuid;
  }
}

describe('getScrubbedSdkEnv', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('drops ANTHROPIC_API_KEY by default so Claude subscription auth can be used', () => {
    process.env.ANTHROPIC_API_KEY = 'stale-api-key';
    delete process.env.CLAUDECLAW_USE_ANTHROPIC_API_KEY;

    const env = getScrubbedSdkEnv({ ANTHROPIC_API_KEY: 'stale-api-key' });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('preserves CLAUDE_CODE_OAUTH_TOKEN when provided explicitly', () => {
    const env = getScrubbedSdkEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token' });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token');
  });

  it('allows ANTHROPIC_API_KEY only when API-key auth is explicitly enabled', () => {
    process.env.CLAUDECLAW_USE_ANTHROPIC_API_KEY = 'true';

    const env = getScrubbedSdkEnv({ ANTHROPIC_API_KEY: 'valid-api-key' });

    expect(env.ANTHROPIC_API_KEY).toBe('valid-api-key');
  });

  it('still drops unrelated secret-shaped env vars', () => {
    process.env.GOOGLE_API_KEY = 'google-key';
    process.env.CUSTOM_SERVICE_TOKEN = 'service-token';
    process.env.PATH = '/usr/bin';

    const env = getScrubbedSdkEnv();

    expect(env.GOOGLE_API_KEY).toBeUndefined();
    expect(env.CUSTOM_SERVICE_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('getScrubbedSdkEnv — IS_SANDBOX root gate (BUG-004)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    restoreGetuid();
  });

  it('injects IS_SANDBOX=1 when running as root and none is set', () => {
    delete process.env.IS_SANDBOX;
    setGetuid(() => 0);

    const env = getScrubbedSdkEnv();

    expect(env.IS_SANDBOX).toBe('1');
  });

  it('does not set IS_SANDBOX for a non-root uid', () => {
    delete process.env.IS_SANDBOX;
    setGetuid(() => 1000);

    const env = getScrubbedSdkEnv();

    expect(env.IS_SANDBOX).toBeUndefined();
  });

  it('preserves a pre-existing IS_SANDBOX value under root', () => {
    process.env.IS_SANDBOX = '0';
    setGetuid(() => 0);

    const env = getScrubbedSdkEnv();

    expect(env.IS_SANDBOX).toBe('0');
  });

  it('does not set IS_SANDBOX when getuid is undefined (Windows)', () => {
    delete process.env.IS_SANDBOX;
    setGetuid(undefined);

    const env = getScrubbedSdkEnv();

    expect(env.IS_SANDBOX).toBeUndefined();
  });
});

describe('getOwnSystemdUnit (BUG-002)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockCgroup(content: string): void {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(content as never);
  }

  it('resolves the owning app unit from a cgroup v2 user-scope line', () => {
    mockCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/claudeclaw.service\n');

    expect(getOwnSystemdUnit()).toEqual({ unit: 'claudeclaw.service', userScope: true });
  });

  it('resolves a system-scope unit and marks userScope false', () => {
    mockCgroup('0::/system.slice/claudeclaw.service\n');

    expect(getOwnSystemdUnit()).toEqual({ unit: 'claudeclaw.service', userScope: false });
  });

  it('returns the .scope for an interactive session (guard discards it later)', () => {
    mockCgroup('0::/user.slice/user-1000.slice/session-97.scope\n');

    expect(getOwnSystemdUnit()).toEqual({ unit: 'session-97.scope', userScope: false });
  });

  it('ignores the user@<uid>.service manager unit as the owner', () => {
    mockCgroup('0::/user.slice/user-1000.slice/user@1000.service\n');

    // Only the manager segment is present → no app unit owner.
    expect(getOwnSystemdUnit()).toBeNull();
  });

  it('returns null when cgroup is unreadable (non-systemd)', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT'); });

    expect(getOwnSystemdUnit()).toBeNull();
  });
});
