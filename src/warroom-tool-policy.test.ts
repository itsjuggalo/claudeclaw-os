import { describe, expect, it } from 'vitest';
import { filterMcpServers, warRoomToolPolicy } from './warroom-tool-policy.js';

const READONLY = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'];
const SIDE_EFFECT = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'ExitPlanMode', 'Skill'];

describe('warRoomToolPolicy read-only floor', () => {
  it('always allows read-only built-ins', () => {
    for (const id of ['main', 'ops', 'comms', 'content', 'research', 'unknown']) {
      expect(warRoomToolPolicy(id).allowedTools).toEqual(expect.arrayContaining(READONLY));
    }
  });

  it('never lists a read-only tool as disallowed', () => {
    const policy = warRoomToolPolicy('main');
    for (const tool of READONLY) {
      expect(policy.disallowedTools).not.toContain(tool);
    }
  });
});

describe('warRoomToolPolicy default deny', () => {
  it('denies every side-effect tool for an agent with no opt-in', () => {
    const policy = warRoomToolPolicy('main');
    expect(policy.disallowedTools).toEqual(expect.arrayContaining(SIDE_EFFECT));
    for (const tool of SIDE_EFFECT) {
      expect(policy.allowedTools).not.toContain(tool);
    }
  });

  it('treats an unknown agent id as read-only', () => {
    const policy = warRoomToolPolicy('agent-that-does-not-exist');
    expect([...policy.allowedTools].sort()).toEqual([...READONLY].sort());
    expect(policy.disallowedTools).toEqual(expect.arrayContaining(SIDE_EFFECT));
  });

  it('exposes no MCP server unless one is opted in', () => {
    for (const id of ['main', 'ops', 'comms', 'content', 'research']) {
      expect(warRoomToolPolicy(id).allowedMcpServers).toEqual([]);
    }
  });
});

describe('warRoomToolPolicy per-agent defaults', () => {
  it('grants ops and comms Bash and Skill', () => {
    for (const id of ['ops', 'comms']) {
      const policy = warRoomToolPolicy(id);
      expect(policy.allowedTools).toEqual(expect.arrayContaining(['Bash', 'Skill']));
      expect(policy.disallowedTools).not.toContain('Bash');
      expect(policy.disallowedTools).not.toContain('Skill');
    }
  });

  it('grants content Skill and Write but withholds Bash', () => {
    const policy = warRoomToolPolicy('content');
    expect(policy.allowedTools).toEqual(expect.arrayContaining(['Skill', 'Write']));
    expect(policy.allowedTools).not.toContain('Bash');
    expect(policy.disallowedTools).toContain('Bash');
  });

  it('keeps main and research read-only', () => {
    for (const id of ['main', 'research']) {
      expect([...warRoomToolPolicy(id).allowedTools].sort()).toEqual([...READONLY].sort());
    }
  });
});

describe('warRoomToolPolicy agent.yaml overrides', () => {
  it('replaces per-agent defaults instead of extending them', () => {
    const policy = warRoomToolPolicy('ops', ['Write']);
    expect(policy.allowedTools).toContain('Write');
    expect(policy.allowedTools).not.toContain('Bash');
    expect(policy.allowedTools).not.toContain('Skill');
    expect(policy.disallowedTools).toContain('Bash');
  });

  it('keeps the read-only floor when a side-effect tool is opted in', () => {
    const policy = warRoomToolPolicy('main', ['Bash']);
    expect(policy.allowedTools).toEqual(expect.arrayContaining([...READONLY, 'Bash']));
  });

  it('does not duplicate a tool already in the read-only set', () => {
    const policy = warRoomToolPolicy('main', ['Read']);
    expect(policy.allowedTools.filter((tool) => tool === 'Read')).toHaveLength(1);
  });

  it('treats an explicit empty list as read-only lockdown', () => {
    const locked = warRoomToolPolicy('ops', []);
    expect([...locked.allowedTools].sort()).toEqual([...READONLY].sort());
    expect(locked.disallowedTools).toEqual(expect.arrayContaining(SIDE_EFFECT));
    expect(warRoomToolPolicy('ops', undefined).allowedTools).toEqual(
      expect.arrayContaining(['Bash', 'Skill']),
    );
  });
});

describe('warRoomToolPolicy MCP opt-in', () => {
  it('extracts mcp-prefixed entries into allowedMcpServers', () => {
    const policy = warRoomToolPolicy('comms', ['Skill', 'mcp:gmail', 'mcp:slack']);
    expect(policy.allowedMcpServers).toEqual(['gmail', 'slack']);
  });

  it('keeps the server name after the first mcp prefix', () => {
    expect(warRoomToolPolicy('ops', ['mcp:google-calendar']).allowedMcpServers)
      .toEqual(['google-calendar']);
  });

  it('does not pass MCP configuration tokens as SDK tool names', () => {
    const policy = warRoomToolPolicy('ops', ['Skill', 'mcp:gmail']);
    expect(policy.allowedTools).toContain('Skill');
    expect(policy.allowedTools).not.toContain('mcp:gmail');
  });

  it('drops empty MCP names and deduplicates repeated server entries', () => {
    const policy = warRoomToolPolicy('ops', ['mcp:', 'mcp:gmail', 'mcp:gmail']);
    expect(policy.allowedMcpServers).toEqual(['gmail']);
  });
});

describe('filterMcpServers', () => {
  const servers = { gmail: { cmd: 'gmail-server' }, slack: { cmd: 'slack-server' } };

  it('drops every server when nothing is opted in', () => {
    expect(filterMcpServers(servers, warRoomToolPolicy('ops'))).toEqual({});
  });

  it('keeps only opted-in servers', () => {
    const policy = warRoomToolPolicy('comms', ['mcp:gmail']);
    expect(filterMcpServers(servers, policy)).toEqual({ gmail: { cmd: 'gmail-server' } });
  });

  it('ignores an opted-in server that is not configured', () => {
    const policy = warRoomToolPolicy('comms', ['mcp:not-installed']);
    expect(filterMcpServers(servers, policy)).toEqual({});
  });

  it('returns a new object without mutating the input', () => {
    const policy = warRoomToolPolicy('comms', ['mcp:gmail']);
    const filtered = filterMcpServers(servers, policy);
    expect(filtered).not.toBe(servers);
    expect(Object.keys(servers)).toEqual(['gmail', 'slack']);
  });
});
