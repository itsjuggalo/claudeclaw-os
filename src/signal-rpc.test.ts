import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'net';

import { SignalRpcClient, SignalIncomingMessage, parseReceiveEnvelope, isSignalCliVersionBelow } from './signal-rpc.js';

// ── Local TCP mock daemon ─────────────────────────────────────────────
// Each test spins up a real TCP server on an ephemeral port so the
// SignalRpcClient can exercise its full framing logic against actual
// socket traffic — no monkey-patching of `net`.

interface MockDaemon {
  port: number;
  socket: net.Socket | null;
  server: net.Server;
  /** How many client connections the server has accepted (for reconnect assertions). */
  connections: number;
  lastRequest: Record<string, unknown> | null;
  requests: Record<string, unknown>[];
  /** Push a JSON-RPC response for the most recent request. */
  reply(result: unknown): void;
  /** Push a server-initiated notification (e.g. an incoming `receive`). */
  notify(method: string, params: unknown): void;
  stop(): Promise<void>;
}

async function startMockDaemon(fixedPort = 0): Promise<MockDaemon> {
  return new Promise((resolve) => {
    const requests: Record<string, unknown>[] = [];
    let currentSocket: net.Socket | null = null;
    let buffer = '';
    let connections = 0;

    const server = net.createServer((sock) => {
      currentSocket = sock;
      buffer = '';
      connections++;
      // The client tears its own socket down on a forced reconnect (e.g. the
      // buffer-cap test #7). That resets this peer socket; without an 'error'
      // handler the ECONNRESET surfaces as an unhandled exception and fails the
      // whole run even though every test passed. Swallow it — it's expected.
      sock.on('error', () => { /* peer reset on client reconnect — expected */ });
      sock.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            requests.push(JSON.parse(line));
          } catch {
            // malformed — ignore
          }
        }
      });
    });

    server.listen(fixedPort, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      const daemon: MockDaemon = {
        port,
        get socket() { return currentSocket; },
        get connections() { return connections; },
        server,
        get lastRequest() { return requests[requests.length - 1] ?? null; },
        requests,
        reply(result) {
          if (!currentSocket) throw new Error('no client connected');
          const last = requests[requests.length - 1];
          const id = last?.id ?? null;
          currentSocket.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
        },
        notify(method, params) {
          if (!currentSocket) throw new Error('no client connected');
          currentSocket.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
        },
        async stop(): Promise<void> {
          return new Promise((res) => {
            try { currentSocket?.destroy(); } catch { /* ok */ }
            server.close(() => res());
          });
        },
      };
      resolve(daemon);
    });
  });
}

/** Wait for a predicate to become true, polling every 10ms. */
async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('SignalRpcClient', () => {
  let daemon: MockDaemon;
  let client: SignalRpcClient;

  beforeEach(async () => {
    daemon = await startMockDaemon();
    client = new SignalRpcClient({
      host: '127.0.0.1',
      port: daemon.port,
      callTimeoutMs: 500,
      probeVersionOnConnect: false, // keep the request stream clean for assertions
    });
    await client.connect();
    // Wait until the server observed the new connection.
    await waitFor(() => daemon.socket !== null);
  });

  afterEach(async () => {
    client.stop();
    await daemon.stop();
  });

  it('sends a send RPC with the correct envelope', async () => {
    const sent = client.send('+491701234567', 'hello');
    await waitFor(() => daemon.lastRequest !== null);
    daemon.reply({ timestamp: 123 });
    await sent;

    expect(daemon.lastRequest).toMatchObject({
      jsonrpc: '2.0',
      method: 'send',
      params: { recipient: ['+491701234567'], message: 'hello' },
    });
    expect(typeof daemon.lastRequest!.id).toBe('number');
  });

  it('passes attachment paths through to the send RPC', async () => {
    const sent = client.sendWithAttachments('+491701234567', 'look at this', ['/tmp/foo.png']);
    await waitFor(() => daemon.lastRequest !== null);
    daemon.reply({ timestamp: 123 });
    await sent;

    expect(daemon.lastRequest).toMatchObject({
      method: 'send',
      params: {
        recipient: ['+491701234567'],
        message: 'look at this',
        attachment: ['/tmp/foo.png'],
      },
    });
  });

  it('swallows "method not found" from sendTyping (best-effort)', async () => {
    // Deliberately not replying with a result — emit a method-not-found error
    // to verify sendTyping silently swallows it.
    const sent = client.sendTyping('+491701234567');
    await waitFor(() => daemon.lastRequest !== null);
    const id = daemon.lastRequest!.id;
    daemon.socket!.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    }) + '\n');

    await expect(sent).resolves.toBeUndefined();
  });

  it('emits message events for incoming receive notifications', async () => {
    const received: SignalIncomingMessage[] = [];
    client.on('message', (msg) => received.push(msg));

    daemon.notify('receive', {
      envelope: {
        source: '+491701234567',
        sourceNumber: '+491701234567',
        sourceName: 'Test User',
        timestamp: 1776843000000,
        dataMessage: {
          message: 'hi from phone',
          attachments: [],
        },
      },
    });

    await waitFor(() => received.length > 0);
    expect(received[0]).toMatchObject({
      sourceNumber: '+491701234567',
      sourceName: 'Test User',
      text: 'hi from phone',
      attachments: [],
      isSync: false,
    });
  });

  it('marks sync messages so the bot can ignore its own echoes', async () => {
    const received: SignalIncomingMessage[] = [];
    client.on('message', (msg) => received.push(msg));

    daemon.notify('receive', {
      envelope: {
        sourceNumber: '+491701234567',
        timestamp: 1776843000000,
        syncMessage: {
          sentMessage: { message: 'self-echo' },
        },
      },
    });

    await waitFor(() => received.length > 0);
    expect(received[0].isSync).toBe(true);
    expect(received[0].text).toBe('self-echo');
  });

  it('drops receipt-only envelopes (no text, no attachments)', async () => {
    const received: SignalIncomingMessage[] = [];
    client.on('message', (msg) => received.push(msg));

    daemon.notify('receive', {
      envelope: {
        sourceNumber: '+491701234567',
        timestamp: 1776843000000,
        receiptMessage: { type: 'READ' },
      },
    });

    // Give the event loop a tick to process.
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('times out a call when the daemon never replies', async () => {
    const call = client.send('+491701234567', 'stuck');
    await expect(call).rejects.toThrow(/timed out/i);
  });

  it('handles framing across packet boundaries', async () => {
    const received: SignalIncomingMessage[] = [];
    client.on('message', (msg) => received.push(msg));

    // Push two events as a single write, separated by \n — forces the
    // client to parse two complete JSON objects out of one buffer.
    const env1 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'receive',
      params: {
        envelope: {
          sourceNumber: '+1',
          timestamp: 1,
          dataMessage: { message: 'first' },
        },
      },
    });
    const env2 = JSON.stringify({
      jsonrpc: '2.0',
      method: 'receive',
      params: {
        envelope: {
          sourceNumber: '+2',
          timestamp: 2,
          dataMessage: { message: 'second' },
        },
      },
    });
    daemon.socket!.write(env1 + '\n' + env2 + '\n');

    await waitFor(() => received.length === 2);
    expect(received.map((m) => m.text)).toEqual(['first', 'second']);
  });

});

describe('SignalRpcClient version probe', () => {
  it('fires a `version` RPC on connect when probing is enabled (default)', async () => {
    const daemon = await startMockDaemon();
    const client = new SignalRpcClient({ host: '127.0.0.1', port: daemon.port, callTimeoutMs: 300 });
    await client.connect();
    await waitFor(() => daemon.requests.some((r) => r.method === 'version'), 2000);
    expect(daemon.requests.find((r) => r.method === 'version')).toMatchObject({ jsonrpc: '2.0', method: 'version' });
    client.stop();
    await daemon.stop();
  });
});

describe('parseReceiveEnvelope', () => {
  it('parses a direct incoming dataMessage', () => {
    const msg = parseReceiveEnvelope({
      envelope: {
        sourceNumber: '+49111',
        sourceName: 'Alice',
        timestamp: 42,
        dataMessage: { message: 'hallo', attachments: [] },
      },
    });
    expect(msg).toMatchObject({ sourceNumber: '+49111', sourceName: 'Alice', text: 'hallo', isSync: false });
  });

  it('parses a note-to-self sync with destinationNumber (the path that regressed)', () => {
    const msg = parseReceiveEnvelope({
      envelope: {
        sourceNumber: '+491701234567',
        timestamp: 7,
        syncMessage: {
          sentMessage: { message: 'note to self', destinationNumber: '+491701234567' },
        },
      },
    });
    expect(msg).toMatchObject({
      isSync: true,
      text: 'note to self',
      destinationNumber: '+491701234567',
      sourceNumber: '+491701234567',
    });
  });

  it('accepts the bare-params form (no envelope wrapper)', () => {
    const msg = parseReceiveEnvelope({
      sourceNumber: '+49222',
      timestamp: 1,
      dataMessage: { message: 'flat' },
    });
    expect(msg?.text).toBe('flat');
  });

  it('falls back to source / body fields', () => {
    const msg = parseReceiveEnvelope({
      envelope: { source: '+49333', timestamp: 1, dataMessage: { body: 'via body' } },
    });
    expect(msg).toMatchObject({ sourceNumber: '+49333', text: 'via body' });
  });

  it('maps attachments (filename, contentType, path/file)', () => {
    const msg = parseReceiveEnvelope({
      envelope: {
        sourceNumber: '+49444',
        timestamp: 1,
        dataMessage: {
          message: '',
          attachments: [{ id: 'a1', contentType: 'audio/aac', filename: 'voice.aac', file: '/tmp/voice.aac' }],
        },
      },
    });
    expect(msg?.attachments[0]).toMatchObject({ id: 'a1', contentType: 'audio/aac', filename: 'voice.aac', path: '/tmp/voice.aac' });
  });

  it('returns null for receipt / typing / empty envelopes', () => {
    expect(parseReceiveEnvelope({ envelope: { sourceNumber: '+1', timestamp: 1, receiptMessage: { type: 'READ' } } })).toBeNull();
    expect(parseReceiveEnvelope({ envelope: { sourceNumber: '+1', timestamp: 1, typingMessage: { action: 'STARTED' } } })).toBeNull();
    expect(parseReceiveEnvelope({ envelope: { sourceNumber: '+1', timestamp: 1, dataMessage: { message: '', attachments: [] } } })).toBeNull();
  });

  it('returns null for non-object / empty params', () => {
    expect(parseReceiveEnvelope(null)).toBeNull();
    expect(parseReceiveEnvelope('nope')).toBeNull();
    expect(parseReceiveEnvelope({})).toBeNull();
  });

  it('ignores a sync without a sentMessage body or attachments', () => {
    expect(parseReceiveEnvelope({
      envelope: { sourceNumber: '+1', timestamp: 1, syncMessage: { readMessages: [] } },
    })).toBeNull();
  });
});

describe('isSignalCliVersionBelow', () => {
  it('flags versions older than the threshold', () => {
    expect(isSignalCliVersionBelow('0.14.2', [0, 14, 5])).toBe(true);
    expect(isSignalCliVersionBelow('0.13.9', [0, 14, 5])).toBe(true);
    expect(isSignalCliVersionBelow('0.14.0', [0, 14, 5])).toBe(true);
  });
  it('accepts the threshold and newer', () => {
    expect(isSignalCliVersionBelow('0.14.5', [0, 14, 5])).toBe(false);
    expect(isSignalCliVersionBelow('0.14.6', [0, 14, 5])).toBe(false);
    expect(isSignalCliVersionBelow('0.15.0', [0, 14, 5])).toBe(false);
    expect(isSignalCliVersionBelow('1.0.0', [0, 14, 5])).toBe(false);
  });
  it('tolerates suffixes and missing patch', () => {
    expect(isSignalCliVersionBelow('0.14.5-SNAPSHOT', [0, 14, 5])).toBe(false);
    expect(isSignalCliVersionBelow('0.14', [0, 14, 5])).toBe(true);   // 0.14.0 < 0.14.5
  });
  it('returns false for unparseable input (never warn spuriously)', () => {
    expect(isSignalCliVersionBelow('unknown', [0, 14, 5])).toBe(false);
    expect(isSignalCliVersionBelow('', [0, 14, 5])).toBe(false);
  });
});

describe('SignalRpcClient reconnect resilience', () => {
  it('keeps retrying across a daemon restart (reschedules failed attempts)', async () => {
    const first = await startMockDaemon();
    const port = first.port;
    const client = new SignalRpcClient({ host: '127.0.0.1', port, callTimeoutMs: 300, probeVersionOnConnect: false });
    await client.connect();
    await waitFor(() => first.socket !== null);

    // Take the daemon fully down — port becomes unavailable. The client's first
    // reconnect attempt (~500ms) will FAIL; the fix must reschedule it.
    await first.stop();

    // Leave the port closed past the first reconnect attempt, then bring a
    // fresh daemon back up on the SAME port. With the old (buggy) code the
    // client gave up after one failed attempt and never reconnects.
    await new Promise((r) => setTimeout(r, 700));
    const second = await startMockDaemon(port);

    const received: SignalIncomingMessage[] = [];
    client.on('message', (m) => received.push(m));
    await waitFor(() => second.socket !== null, 4000);

    second.notify('receive', {
      envelope: { sourceNumber: '+49999', timestamp: 1, dataMessage: { message: 'back online' } },
    });
    await waitFor(() => received.length > 0, 2000);
    expect(received[0].text).toBe('back online');

    client.stop();
    await second.stop();
  });

  it('connectWithRetry survives a daemon-down cold start (no throw) and connects once it comes up', async () => {
    // Grab a port, then take it down so the initial connect must fail — the
    // boot race where signal-cli starts slower than the bot.
    const seed = await startMockDaemon();
    const port = seed.port;
    await seed.stop();

    const client = new SignalRpcClient({ host: '127.0.0.1', port, callTimeoutMs: 300, probeVersionOnConnect: false });

    // Bare connect() would reject here (→ bootMessenger process.exit(1)).
    // connectWithRetry must resolve and schedule a background reconnect.
    await expect(client.connectWithRetry()).resolves.toBeUndefined();

    // Daemon comes up on the same port; the scheduled reconnect must attach.
    const daemon = await startMockDaemon(port);
    const received: SignalIncomingMessage[] = [];
    client.on('message', (m) => received.push(m));
    await waitFor(() => daemon.socket !== null, 4000);

    daemon.notify('receive', {
      envelope: { sourceNumber: '+49999', timestamp: 1, dataMessage: { message: 'up now' } },
    });
    await waitFor(() => received.length > 0, 2000);
    expect(received[0].text).toBe('up now');

    client.stop();
    await daemon.stop();
  });
});

describe('SignalRpcClient transport hardening', () => {
  it('stop() cancels a pending reconnect — no resurrection after shutdown (#5)', async () => {
    const first = await startMockDaemon();
    const port = first.port;
    const client = new SignalRpcClient({ host: '127.0.0.1', port, callTimeoutMs: 300, probeVersionOnConnect: false });
    await client.connect();
    await waitFor(() => first.connections === 1);

    // Daemon down → client's close handler schedules a reconnect (~500ms).
    await first.stop();
    // Immediately stop the client, before that timer fires.
    client.stop();

    // Fresh daemon on the same port, waited well past the reconnect window.
    // A correctly-stopped client must NOT reconnect.
    const second = await startMockDaemon(port);
    await new Promise((r) => setTimeout(r, 900));
    expect(second.connections).toBe(0);

    await second.stop();
  });

  it('resets the receive buffer on disconnect so a partial frame cannot corrupt the next line (#6)', async () => {
    const daemon = await startMockDaemon();
    const client = new SignalRpcClient({ host: '127.0.0.1', port: daemon.port, callTimeoutMs: 300, probeVersionOnConnect: false });
    await client.connect();
    await waitFor(() => daemon.connections === 1);

    const received: SignalIncomingMessage[] = [];
    client.on('message', (m) => received.push(m));

    // Partial frame with NO trailing newline, then drop the socket.
    daemon.socket!.write('{"jsonrpc":"2.0","method":"receive","params":{"envelope":{"sourceNumber":"+1","timestamp":1,"dataMessage":{"message":"HALF');
    daemon.socket!.destroy(); // client close handler must clear the buffer

    // Client reconnects to the same still-listening server.
    await waitFor(() => daemon.connections === 2, 4000);

    // A fresh complete frame must parse cleanly — not be prefixed by the
    // leftover "HALF…" fragment (which would break JSON.parse and drop it).
    daemon.notify('receive', {
      envelope: { sourceNumber: '+49', timestamp: 2, dataMessage: { message: 'clean' } },
    });
    await waitFor(() => received.length === 1, 2000);
    expect(received[0].text).toBe('clean');

    client.stop();
    await daemon.stop();
  });

  it('caps an unbounded newline-less receive buffer and forces reconnect (#7)', async () => {
    const daemon = await startMockDaemon();
    const client = new SignalRpcClient({ host: '127.0.0.1', port: daemon.port, callTimeoutMs: 300, probeVersionOnConnect: false });
    await client.connect();
    await waitFor(() => daemon.socket !== null);

    let clientDisconnected = false;
    daemon.socket!.on('close', () => { clientDisconnected = true; });

    // > 8 MB with no newline → the client must destroy the socket.
    daemon.socket!.write('x'.repeat(9 * 1024 * 1024));

    await waitFor(() => clientDisconnected, 4000);
    expect(clientDisconnected).toBe(true);

    client.stop();
    await daemon.stop();
  });
});
