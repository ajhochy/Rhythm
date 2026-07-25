/**
 * Trusted per-call identity injected by the Rhythm opencode fork in MCP
 * request metadata. It is intentionally not a tool argument: model-produced
 * JSON can never select another session, turn, agent, or call id.
 */

import type { ToolRequestExtra } from '../tools/_tool.js';

export const RHYTHM_SECURITY_CONTEXT_META_KEY = 'com.vcrc.rhythm/security-context';

export interface TrustedSecurityContext {
  sdkSessionId: string;
  turnId: string;
  agentName: string;
  toolCallId: string;
}

function safeIdentity(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function trustedSecurityContext(extra: ToolRequestExtra | undefined): TrustedSecurityContext | null {
  const raw = extra?._meta?.[RHYTHM_SECURITY_CONTEXT_META_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    !safeIdentity(record.sdkSessionId, 200) ||
    !safeIdentity(record.turnId, 200) ||
    !safeIdentity(record.agentName, 200) ||
    !safeIdentity(record.toolCallId, 200)
  ) {
    return null;
  }
  return {
    sdkSessionId: record.sdkSessionId,
    turnId: record.turnId,
    agentName: record.agentName,
    toolCallId: record.toolCallId,
  };
}
