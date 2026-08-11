// Mindfield-only file. Signal group → agent routing, the Signal analogue of
// Mattermost's MATTERMOST_CHANNEL_AGENT_MAP (see mattermost-config.ts).
//
// Why a JSON file in store/ instead of .env: the group map is not a secret,
// and keeping it out of .env lets tooling (and Claude sessions) manage it
// without touching the credentials file. Processes read it once at boot —
// after editing, restart the affected services (same contract as .env).
//
// File shape (store/signal-groups.json):
//   { "<base64GroupId>": "<agentId>", ... }
//
// Routing rules (enforced by shouldHandleInbound):
//   - Group message + group mapped to me       → mine.
//   - Group message + mapped to another agent  → not mine (that process owns it).
//   - Group message + unmapped group           → NOBODY answers (conservative:
//     the bot must never talk in a group it wasn't explicitly given).
//   - 1:1 / Note-to-Self                       → main only (unchanged behavior).

import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

export const SIGNAL_GROUPS_FILE = path.join(STORE_DIR, 'signal-groups.json');

export function loadSignalGroupMap(file: string = SIGNAL_GROUPS_FILE): Record<string, string> {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    const map: Record<string, string> = {};
    for (const [groupId, agentId] of Object.entries(raw)) {
      if (typeof agentId === 'string' && agentId.trim()) map[groupId] = agentId.trim();
    }
    return map;
  } catch (err) {
    logger.warn({ err, file }, 'signal-groups.json unreadable — group routing disabled');
    return {};
  }
}

/** Loaded once at boot, like .env. Restart services after editing the file. */
export const SIGNAL_GROUP_AGENT_MAP: Record<string, string> = loadSignalGroupMap();

/** True if this agent owns the given group (explicit mapping only). */
export function ownsGroup(
  groupId: string,
  agentId: string,
  map: Record<string, string> = SIGNAL_GROUP_AGENT_MAP,
): boolean {
  return map[groupId] === agentId;
}

/** First group id mapped to this agent (its report/status destination), if any. */
export function groupForAgent(
  agentId: string,
  map: Record<string, string> = SIGNAL_GROUP_AGENT_MAP,
): string | undefined {
  for (const [groupId, mapped] of Object.entries(map)) {
    if (mapped === agentId) return groupId;
  }
  return undefined;
}

/** True if any group is mapped to this agent (gates the inbound subscribe). */
export function agentHasGroups(
  agentId: string,
  map: Record<string, string> = SIGNAL_GROUP_AGENT_MAP,
): boolean {
  return groupForAgent(agentId, map) !== undefined;
}

export interface InboundRouteMessage {
  groupId?: string;
  isSync: boolean;
  destinationNumber?: string;
}

/**
 * Decide whether the agent running this process should handle an inbound
 * Signal message. Pure function (map injectable) so the routing matrix is
 * unit-testable. Authorisation (sender allowlist) is checked separately by
 * the caller — this only answers "is this conversation mine?".
 */
export function shouldHandleInbound(
  msg: InboundRouteMessage,
  agentId: string,
  ownNumber: string,
  map: Record<string, string> = SIGNAL_GROUP_AGENT_MAP,
): boolean {
  if (msg.groupId) {
    // Group syncs (Q posting in the group from another linked device) carry no
    // destinationNumber — the group itself is the destination, so the 1:1
    // Note-to-Self destination check below must not apply here.
    return ownsGroup(msg.groupId, agentId, map);
  }
  // 1:1 path: main only, and syncs only when they are Note-to-Self.
  if (agentId !== 'main') return false;
  if (msg.isSync && msg.destinationNumber !== ownNumber) return false;
  return true;
}
