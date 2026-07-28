import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
  type JsonWebKey,
} from 'node:crypto';

import { env } from '../../config/env';
import {
  canonicalHumanApprovalDecision,
  HUMAN_APPROVAL_CAPABILITY_HEADER,
} from '../../security/human_approval_security';

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export interface HumanApprovalTestCredentials {
  capability: string;
  capabilityHeader: Record<string, string>;
  privateKey: KeyObject;
  publicKey: string;
}

export function installHumanApprovalTestCredentials(): HumanApprovalTestCredentials {
  const capability = `test-human-${randomUUID()}`;
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  if (!jwk.x || !jwk.y) {
    throw new Error('P-256 test key is missing public coordinates');
  }
  const rawPublicKey = Buffer.concat([
    Buffer.from([0x04]),
    decodeBase64Url(jwk.x),
    decodeBase64Url(jwk.y),
  ]).toString('base64');

  env.humanApprovalCapabilitySha256 = createHash('sha256')
    .update(capability)
    .digest('hex');
  env.humanApprovalPublicKey = rawPublicKey;

  return {
    capability,
    capabilityHeader: {
      [HUMAN_APPROVAL_CAPABILITY_HEADER]: capability,
    },
    privateKey,
    publicKey: rawPublicKey,
  };
}

export function signHumanApprovalDecision(
  credentials: HumanApprovalTestCredentials,
  approval: {
    id: string;
    decisionNonce: string;
    payloadDigest: string | null;
  },
  status: 'approved' | 'rejected',
  overrides: Partial<{
    id: string;
    decisionNonce: string;
    payloadDigest: string | null;
    status: 'approved' | 'rejected';
  }> = {},
): string {
  const message = canonicalHumanApprovalDecision({
    approvalId: overrides.id ?? approval.id,
    status: overrides.status ?? status,
    decisionNonce: overrides.decisionNonce ?? approval.decisionNonce,
    payloadDigest:
      overrides.payloadDigest === undefined
        ? approval.payloadDigest
        : overrides.payloadDigest,
  });
  return sign('sha256', Buffer.from(message), credentials.privateKey).toString(
    'base64',
  );
}
