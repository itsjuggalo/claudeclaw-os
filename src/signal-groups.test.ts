import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';

import { loadSignalGroupMap, ownsGroup, groupForAgent, agentHasGroups, shouldHandleInbound } from './signal-groups.js';
import { buildSendParams, groupRecipient, groupIdFromRecipient, isGroupRecipient, parseReceiveEnvelope } from './signal-rpc.js';
import { chatIdFor } from './signal-bot.js';

// MINDFIELD Signal-Gruppen (2026-07-16): the group→agent map routes group
// conversations to dedicated agent processes (HealthOS use case), while 1:1 /
// Note-to-Self stays with main. Mirrors the Mattermost ownsChannel pattern.

const OWN = '+491701234567';
const GID = 'ffhK2eXCTJq0uwuGvloJZY0Pkr1g4qk8Tx8DhSAOTPk=';
const MAP = { [GID]: 'health' };

describe('shouldHandleInbound routing matrix', () => {
  it('routes a mapped group message to its owning agent only', () => {
    const msg = { groupId: GID, isSync: false };
    expect(shouldHandleInbound(msg, 'health', OWN, MAP)).toBe(true);
    expect(shouldHandleInbound(msg, 'main', OWN, MAP)).toBe(false);
    expect(shouldHandleInbound(msg, 'comms', OWN, MAP)).toBe(false);
  });

  it('drops unmapped group messages for EVERY agent (conservative default)', () => {
    const msg = { groupId: 'someOtherGroup=', isSync: false };
    expect(shouldHandleInbound(msg, 'main', OWN, MAP)).toBe(false);
    expect(shouldHandleInbound(msg, 'health', OWN, MAP)).toBe(false);
  });

  it('passes group SYNCS (Q posting from phone, no destinationNumber) to the owner', () => {
    const msg = { groupId: GID, isSync: true, destinationNumber: undefined };
    expect(shouldHandleInbound(msg, 'health', OWN, MAP)).toBe(true);
    expect(shouldHandleInbound(msg, 'main', OWN, MAP)).toBe(false);
  });

  it('keeps Note-to-Self syncs with main (regression: pre-group behavior)', () => {
    const noteToSelf = { isSync: true, destinationNumber: OWN };
    expect(shouldHandleInbound(noteToSelf, 'main', OWN, MAP)).toBe(true);
    expect(shouldHandleInbound(noteToSelf, 'health', OWN, MAP)).toBe(false);
  });

  it('drops syncs of messages Q sent to other people', () => {
    const toSomeoneElse = { isSync: true, destinationNumber: '+4915559876543' };
    expect(shouldHandleInbound(toSomeoneElse, 'main', OWN, MAP)).toBe(false);
    expect(shouldHandleInbound(toSomeoneElse, 'health', OWN, MAP)).toBe(false);
  });

  it('gives direct 1:1 messages to main only', () => {
    const direct = { isSync: false };
    expect(shouldHandleInbound(direct, 'main', OWN, MAP)).toBe(true);
    expect(shouldHandleInbound(direct, 'health', OWN, MAP)).toBe(false);
  });
});

describe('group map helpers', () => {
  it('ownsGroup / groupForAgent / agentHasGroups agree with the map', () => {
    expect(ownsGroup(GID, 'health', MAP)).toBe(true);
    expect(ownsGroup(GID, 'main', MAP)).toBe(false);
    expect(groupForAgent('health', MAP)).toBe(GID);
    expect(groupForAgent('main', MAP)).toBeUndefined();
    expect(agentHasGroups('health', MAP)).toBe(true);
    expect(agentHasGroups('comms', MAP)).toBe(false);
  });

  it('loadSignalGroupMap reads a JSON file and skips junk values', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-groups-')), 'signal-groups.json');
    fs.writeFileSync(file, JSON.stringify({ [GID]: 'health', bad: 42, empty: '  ' }));
    expect(loadSignalGroupMap(file)).toEqual({ [GID]: 'health' });
  });

  it('loadSignalGroupMap returns {} for missing or corrupt files', () => {
    expect(loadSignalGroupMap('/nonexistent/signal-groups.json')).toEqual({});
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-groups-')), 'signal-groups.json');
    fs.writeFileSync(file, 'not json');
    expect(loadSignalGroupMap(file)).toEqual({});
  });
});

describe('group recipient encoding + send params', () => {
  it('round-trips a group id through the recipient prefix', () => {
    const r = groupRecipient(GID);
    expect(isGroupRecipient(r)).toBe(true);
    expect(groupIdFromRecipient(r)).toBe(GID);
    expect(isGroupRecipient(OWN)).toBe(false);
  });

  it('buildSendParams targets groupId for group recipients, recipient[] otherwise', () => {
    expect(buildSendParams(groupRecipient(GID), { message: 'hi' }))
      .toEqual({ groupId: GID, message: 'hi' });
    expect(buildSendParams(OWN, { message: 'hi' }))
      .toEqual({ recipient: [OWN], message: 'hi' });
  });

  it('chatIdFor uses the group recipient for group messages, sourceNumber otherwise', () => {
    expect(chatIdFor({ groupId: GID, sourceNumber: OWN })).toBe(groupRecipient(GID));
    expect(chatIdFor({ sourceNumber: OWN })).toBe(OWN);
  });
});

describe('parseReceiveEnvelope group envelopes', () => {
  it('extracts groupId from a direct dataMessage with groupInfo', () => {
    const msg = parseReceiveEnvelope({
      envelope: {
        sourceNumber: '+491701234567',
        timestamp: 1,
        dataMessage: { message: 'hallo', groupInfo: { groupId: GID, type: 'DELIVER' } },
      },
    });
    expect(msg?.groupId).toBe(GID);
    expect(msg?.isSync).toBe(false);
  });

  it('extracts groupId from a sync of Q posting in the group (no destination)', () => {
    const msg = parseReceiveEnvelope({
      envelope: {
        sourceNumber: OWN,
        timestamp: 1,
        syncMessage: { sentMessage: { message: 'morgen check', groupInfo: { groupId: GID } } },
      },
    });
    expect(msg?.groupId).toBe(GID);
    expect(msg?.isSync).toBe(true);
    expect(msg?.destinationNumber).toBeUndefined();
  });

  it('leaves groupId undefined for plain 1:1 and Note-to-Self envelopes', () => {
    const direct = parseReceiveEnvelope({
      envelope: { sourceNumber: OWN, timestamp: 1, dataMessage: { message: 'hi' } },
    });
    expect(direct?.groupId).toBeUndefined();
    const noteToSelf = parseReceiveEnvelope({
      envelope: {
        sourceNumber: OWN,
        timestamp: 1,
        syncMessage: { sentMessage: { message: 'note', destinationNumber: OWN } },
      },
    });
    expect(noteToSelf?.groupId).toBeUndefined();
    expect(noteToSelf?.destinationNumber).toBe(OWN);
  });
});
