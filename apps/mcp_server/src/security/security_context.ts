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

export interface TrustedSecurityProof {
  version: 1;
  algorithm: 'Ed25519';
  keyId: string;
  issuedAt: number;
  nonce: string;
  toolName: string;
  argumentsHash: string;
  signature: string;
}

export interface TrustedSecurityCall {
  context: TrustedSecurityContext;
  proof: TrustedSecurityProof;
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

export function trustedSecurityCall(
  extra: ToolRequestExtra | undefined,
): TrustedSecurityCall | null {
  const context = trustedSecurityContext(extra);
  if (!context) return null;
  const raw = extra?._meta?.[RHYTHM_SECURITY_CONTEXT_META_KEY] as
    | Record<string, unknown>
    | undefined;
  const proof = raw?.proof;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return null;
  const record = proof as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.algorithm !== 'Ed25519' ||
    !safeIdentity(record.keyId, 100) ||
    typeof record.issuedAt !== 'number' ||
    !Number.isSafeInteger(record.issuedAt) ||
    !safeIdentity(record.nonce, 100) ||
    !safeIdentity(record.toolName, 200) ||
    !safeIdentity(record.argumentsHash, 100) ||
    !safeIdentity(record.signature, 200)
  ) {
    return null;
  }
  return {
    context,
    proof: {
      version: 1,
      algorithm: 'Ed25519',
      keyId: record.keyId,
      issuedAt: record.issuedAt,
      nonce: record.nonce,
      toolName: record.toolName,
      argumentsHash: record.argumentsHash,
      signature: record.signature,
    },
  };
}
