import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  renderQuestion,
  parseReply,
  makeSignalAskUserQuestionResolver,
  feedPendingSignalQuestion,
  hasPendingSignalQuestion,
} from './signal-askuserquestion.js';
import type { AskUserQuestionItem, AskUserQuestionRequest } from './agent-engine/index.js';

const Q = (over: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem => ({
  question: 'Welche DB?',
  header: 'DB',
  options: [
    { label: 'Postgres', description: 'relational' },
    { label: 'SQLite' },
    { label: 'Redis' },
  ],
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderQuestion', () => {
  it('numbers options and includes the reply hint', () => {
    const out = renderQuestion(Q(), 0, 1);
    expect(out).toContain('❓ Welche DB?');
    expect(out).toContain('1. Postgres — relational');
    expect(out).toContain('2. SQLite');
    expect(out).toContain('„go"');
    expect(out).toContain('„stop"');
    expect(out).not.toContain('(1/'); // single question → no stepper prefix
  });

  it('adds a stepper prefix and multi-select hint when applicable', () => {
    const out = renderQuestion(Q({ multiSelect: true }), 1, 3);
    expect(out).toContain('(2/3)');
    expect(out).toContain('mehrere mit Komma');
  });
});

describe('parseReply', () => {
  it('maps a single number to its option label', () => {
    expect(parseReply('1', Q())).toEqual({ selected: ['Postgres'] });
  });

  it('honours multi-select with comma-separated numbers', () => {
    expect(parseReply('1,3', Q({ multiSelect: true }))).toEqual({ selected: ['Postgres', 'Redis'] });
  });

  it('keeps only the first pick for single-select even if several numbers given', () => {
    expect(parseReply('2 3', Q())).toEqual({ selected: ['SQLite'] });
  });

  it('treats out-of-range numbers as free text', () => {
    expect(parseReply('9', Q())).toEqual({ selected: ['9'] });
  });

  it('passes free text through verbatim', () => {
    expect(parseReply('MariaDB bitte', Q())).toEqual({ selected: ['MariaDB bitte'] });
  });

  it('recognises stop / go control words (case-insensitive)', () => {
    expect(parseReply('STOP', Q())).toEqual({ control: 'stop' });
    expect(parseReply('go', Q())).toEqual({ control: 'go' });
    expect(parseReply('weiter', Q())).toEqual({ control: 'go' });
  });
});

describe('makeSignalAskUserQuestionResolver', () => {
  const req = (questions: AskUserQuestionItem[]): AskUserQuestionRequest => ({ questions });

  it('sends the question and resolves with the chosen label', async () => {
    const sent: string[] = [];
    const send = vi.fn(async (_c: string, t: string) => { sent.push(t); });
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send);

    const promise = resolver(req([Q()]));
    // The resolver has sent the question and is now awaiting a reply.
    await vi.waitFor(() => expect(hasPendingSignalQuestion('+49chat')).toBe(true));
    expect(feedPendingSignalQuestion('+49chat', '1')).toBe(true);

    const answer = await promise;
    expect(answer).toEqual({ answers: [{ header: 'DB', question: 'Welche DB?', selected: ['Postgres'] }] });
    expect(sent[0]).toContain('Welche DB?');
  });

  it('registers the reply waiter before the send round-trip completes (#8 race)', async () => {
    // Gate the send so it is observably in-flight. Under the old code the waiter
    // was only registered AFTER the send resolved, so a reply arriving during
    // the round-trip fell through to a new agent turn. The fix registers first.
    let releaseSend: () => void = () => {};
    const sendGate = new Promise<void>((r) => { releaseSend = r; });
    const send = vi.fn(async () => { await sendGate; });
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send);

    const promise = resolver(req([Q()]));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // Send is still in-flight, yet the waiter must already be live.
    expect(hasPendingSignalQuestion('+49chat')).toBe(true);
    expect(feedPendingSignalQuestion('+49chat', '1')).toBe(true);

    releaseSend();
    const answer = await promise;
    expect(answer?.answers[0].selected).toEqual(['Postgres']);
  });

  it('walks multiple questions as a stepper', async () => {
    const send = vi.fn(async () => {});
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send);
    const promise = resolver(req([Q(), Q({ header: 'Cache', question: 'Welcher Cache?' })]));

    await vi.waitFor(() => expect(hasPendingSignalQuestion('+49chat')).toBe(true));
    feedPendingSignalQuestion('+49chat', '2'); // SQLite
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2)); // second question sent
    feedPendingSignalQuestion('+49chat', '3'); // Redis

    const answer = await promise;
    expect(answer?.answers.map((a) => a.selected)).toEqual([['SQLite'], ['Redis']]);
  });

  it('"go" stops asking and returns the proceed directive', async () => {
    const send = vi.fn(async () => {});
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send);
    const promise = resolver(req([Q(), Q()]));
    await vi.waitFor(() => expect(hasPendingSignalQuestion('+49chat')).toBe(true));
    feedPendingSignalQuestion('+49chat', 'go');
    const answer = await promise;
    expect(answer?.directive).toMatch(/proceed/i);
    expect(answer?.answers).toEqual([]);
  });

  it('"stop" aborts the turn and resolves null', async () => {
    const send = vi.fn(async () => {});
    const abort = new AbortController();
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send, abort);
    const promise = resolver(req([Q()]));
    await vi.waitFor(() => expect(hasPendingSignalQuestion('+49chat')).toBe(true));
    feedPendingSignalQuestion('+49chat', 'stop');
    const answer = await promise;
    expect(answer).toBeNull();
    expect(abort.signal.aborted).toBe(true);
  });

  it('returns immediately with the proceed directive when already aborted', async () => {
    const send = vi.fn(async () => {});
    const abort = new AbortController();
    abort.abort();
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send, abort);
    const answer = await resolver(req([Q()]));
    expect(answer).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('feedPendingSignalQuestion returns false when nothing is pending', () => {
    expect(feedPendingSignalQuestion('+49nobody', 'hi')).toBe(false);
  });

  it('external abort (e.g. /stop) resolves null without the "continuing" message', async () => {
    const sent: string[] = [];
    const send = vi.fn(async (_c: string, t: string) => { sent.push(t); });
    const abort = new AbortController();
    const resolver = makeSignalAskUserQuestionResolver('+49chat', send, abort);
    const promise = resolver(req([Q()]));
    await vi.waitFor(() => expect(hasPendingSignalQuestion('+49chat')).toBe(true));
    abort.abort(); // simulates /stop aborting the in-flight turn
    const answer = await promise;
    expect(answer).toBeNull();
    // The question itself was sent, but no "ich mache weiter" continuation note.
    expect(sent.some((t) => /mache mit meiner besten/i.test(t))).toBe(false);
  });
});
