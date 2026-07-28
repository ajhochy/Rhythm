import {
  createHash,
  createPublicKey,
  type KeyObject,
  verify,
} from 'node:crypto';

const TRUSTED_CALL_MAX_AGE_MS = 60_000;
const TRUSTED_CALL_FUTURE_SKEW_MS = 5_000;
const ENGINE_SECURITY_KEY_PATH = '/global/rhythm/security-key';

export interface TrustedMcpCallIdentity {
  sdkSessionId: string;
  turnId: string;
  agentName: string;
  toolCallId: string;
}

export interface TrustedMcpCallProof {
  version: 1;
  algorithm: 'Ed25519';
  keyId: string;
  issuedAt: number;
  nonce: string;
  toolName: string;
  argumentsHash: string;
  signature: string;
}

export interface VerifiedTrustedMcpCall {
  context: TrustedMcpCallIdentity;
  arguments: Record<string, unknown>;
}

interface EngineSecurityKey {
  version: 1;
  algorithm: 'Ed25519';
  keyId: string;
  publicKey: string;
}

interface PinnedEngineSecurityKey {
  keyId: string;
  key: KeyObject;
}

let pinnedKey: PinnedEngineSecurityKey | null = null;
const consumedNonces = new Map<string, number>();

function boundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('trusted MCP arguments contain a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name])}`)
      .join(',')}}`;
  }
  throw new Error(
    `trusted MCP arguments contain unsupported ${typeof value} value`,
  );
}

function hashArguments(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value))
    .digest('base64url');
}

function signingPayload(
  context: TrustedMcpCallIdentity,
  proof: TrustedMcpCallProof,
): string {
  return JSON.stringify([
    'rhythm.mcp.tool-call.v1',
    proof.keyId,
    proof.issuedAt,
    proof.nonce,
    proof.toolName,
    proof.argumentsHash,
    context.sdkSessionId,
    context.turnId,
    context.agentName,
    context.toolCallId,
  ]);
}

function parseEnginePort(): number {
  const raw = process.env.RHYTHM_OPENCODE_ENGINE_PORT?.trim();
  if (!raw) return 4096;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('invalid RHYTHM_OPENCODE_ENGINE_PORT');
  }
  return port;
}

function engineAuthorizationHeader(): string | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function parseEngineSecurityKey(value: unknown): EngineSecurityKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('engine security key response is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.algorithm !== 'Ed25519' ||
    !boundedString(record.keyId, 100) ||
    !boundedString(record.publicKey, 200)
  ) {
    throw new Error('engine security key response is invalid');
  }
  const publicKeyBytes = Buffer.from(record.publicKey, 'base64url');
  const actualKeyId = createHash('sha256')
    .update(publicKeyBytes)
    .digest('base64url');
  if (actualKeyId !== record.keyId) {
    throw new Error('engine security key fingerprint mismatch');
  }
  return {
    version: 1,
    algorithm: 'Ed25519',
    keyId: record.keyId,
    publicKey: record.publicKey,
  };
}

export function pinTrustedMcpPublicKey(value: unknown): void {
  const document = parseEngineSecurityKey(value);
  pinnedKey = {
    keyId: document.keyId,
    key: createPublicKey({
      key: Buffer.from(document.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    }),
  };
  consumedNonces.clear();
}

export function clearTrustedMcpVerifier(): void {
  pinnedKey = null;
  consumedNonces.clear();
}

export async function initializeTrustedMcpVerifier(): Promise<boolean> {
  const authorization = engineAuthorizationHeader();
  const response = await fetch(
    `http://127.0.0.1:${parseEnginePort()}${ENGINE_SECURITY_KEY_PATH}`,
    {
      headers: {
        Accept: 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: AbortSignal.timeout(2_000),
    },
  );
  if (!response.ok) return false;
  pinTrustedMcpPublicKey(await response.json());
  return true;
}

function parseTrustedCall(value: unknown): {
  context: TrustedMcpCallIdentity;
  proof: TrustedMcpCallProof;
  arguments: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('trusted MCP call is missing');
  }
  const record = value as Record<string, unknown>;
  const context = record.context;
  const proof = record.proof;
  const args = record.arguments;
  if (
    !context ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    !proof ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args)
  ) {
    throw new Error('trusted MCP call is malformed');
  }
  const contextRecord = context as Record<string, unknown>;
  const proofRecord = proof as Record<string, unknown>;
  if (
    !boundedString(contextRecord.sdkSessionId, 200) ||
    !boundedString(contextRecord.turnId, 200) ||
    !boundedString(contextRecord.agentName, 200) ||
    !boundedString(contextRecord.toolCallId, 200) ||
    proofRecord.version !== 1 ||
    proofRecord.algorithm !== 'Ed25519' ||
    !boundedString(proofRecord.keyId, 100) ||
    typeof proofRecord.issuedAt !== 'number' ||
    !Number.isSafeInteger(proofRecord.issuedAt) ||
    !boundedString(proofRecord.nonce, 100) ||
    !boundedString(proofRecord.toolName, 200) ||
    !boundedString(proofRecord.argumentsHash, 100) ||
    !boundedString(proofRecord.signature, 200)
  ) {
    throw new Error('trusted MCP call is malformed');
  }
  return {
    context: {
      sdkSessionId: contextRecord.sdkSessionId,
      turnId: contextRecord.turnId,
      agentName: contextRecord.agentName,
      toolCallId: contextRecord.toolCallId,
    },
    proof: {
      version: 1,
      algorithm: 'Ed25519',
      keyId: proofRecord.keyId,
      issuedAt: proofRecord.issuedAt,
      nonce: proofRecord.nonce,
      toolName: proofRecord.toolName,
      argumentsHash: proofRecord.argumentsHash,
      signature: proofRecord.signature,
    },
    arguments: args as Record<string, unknown>,
  };
}

function pruneConsumedNonces(now: number): void {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) consumedNonces.delete(nonce);
  }
}

export async function verifyTrustedMcpCall(
  value: unknown,
  expectedToolName: string,
  now = Date.now(),
  nonceScope = expectedToolName,
): Promise<VerifiedTrustedMcpCall> {
  const call = parseTrustedCall(value);
  if (!pinnedKey || pinnedKey.keyId !== call.proof.keyId) {
    throw new Error('trusted MCP engine key is unavailable');
  }
  if (
    call.proof.toolName !== expectedToolName ||
    call.proof.argumentsHash !== hashArguments(call.arguments)
  ) {
    throw new Error('trusted MCP call payload mismatch');
  }
  if (
    call.proof.issuedAt < now - TRUSTED_CALL_MAX_AGE_MS ||
    call.proof.issuedAt > now + TRUSTED_CALL_FUTURE_SKEW_MS
  ) {
    throw new Error('trusted MCP call is expired');
  }
  pruneConsumedNonces(now);
  // A single MCP invocation can legitimately cross more than one fixed
  // server boundary. Creative capability install, for example, consumes its
  // taint approval and then presents the same engine proof to the installer
  // route. Domain-separate replay state by server-selected boundary name:
  // each boundary accepts the nonce once, while callers cannot choose a scope.
  const scopedNonce = `${nonceScope}\0${call.proof.nonce}`;
  if (consumedNonces.has(scopedNonce)) {
    throw new Error('trusted MCP call was already consumed');
  }
  const signatureValid = verify(
    null,
    Buffer.from(signingPayload(call.context, call.proof)),
    pinnedKey.key,
    Buffer.from(call.proof.signature, 'base64url'),
  );
  if (!signatureValid) {
    throw new Error('trusted MCP call signature is invalid');
  }
  consumedNonces.set(
    scopedNonce,
    call.proof.issuedAt + TRUSTED_CALL_MAX_AGE_MS,
  );
  return {
    context: call.context,
    arguments: call.arguments,
  };
}
