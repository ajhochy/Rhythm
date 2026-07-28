import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

interface Identity {
  sdkSessionId: string;
  turnId: string;
  agentName: string;
  toolCallId: string;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name])}`)
    .join(',')}}`;
}

export function createTrustedMcpTestSigner() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' });
  const keyId = createHash('sha256').update(publicKey).digest('base64url');
  return {
    publicDocument: {
      version: 1 as const,
      algorithm: 'Ed25519' as const,
      keyId,
      publicKey: Buffer.from(publicKey).toString('base64url'),
    },
    signCall(
      context: Identity,
      toolName: string,
      args: Record<string, unknown>,
      issuedAt = Date.now(),
    ) {
      const proof = {
        version: 1 as const,
        algorithm: 'Ed25519' as const,
        keyId,
        issuedAt,
        nonce: randomBytes(18).toString('base64url'),
        toolName,
        argumentsHash: createHash('sha256')
          .update(canonicalJson(args))
          .digest('base64url'),
      };
      const payload = JSON.stringify([
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
      return {
        context,
        proof: {
          ...proof,
          signature: sign(null, Buffer.from(payload), keys.privateKey).toString(
            'base64url',
          ),
        },
        arguments: args,
      };
    },
  };
}
