import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/app_error';

export const HUMAN_APPROVAL_CAPABILITY_HEADER =
  'X-Rhythm-Human-Approval';

function base64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function publicKeyFromRawBase64(encoded: string): KeyObject {
  const normalized = encoded.trim();
  const raw = Buffer.from(normalized, 'base64');
  if (
    raw.length !== 65 ||
    raw[0] !== 0x04 ||
    raw.toString('base64').replace(/=+$/g, '') !==
      normalized.replace(/=+$/g, '')
  ) {
    throw new Error(
      'HUMAN_APPROVAL_PUBLIC_KEY must be a canonical base64 P-256 uncompressed public key',
    );
  }
  return createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64Url(raw.subarray(1, 33)),
      y: base64Url(raw.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

export function validateHumanApprovalConfiguration(input: {
  capabilitySha256: string;
  publicKey: string;
}): void {
  if (!/^[a-f0-9]{64}$/.test(input.capabilitySha256)) {
    throw new Error(
      'HUMAN_APPROVAL_CAPABILITY_SHA256 must be a lowercase SHA-256 digest',
    );
  }
  publicKeyFromRawBase64(input.publicKey);
}

export function canonicalHumanApprovalDecision(input: {
  approvalId: string;
  status: 'approved' | 'rejected';
  decisionNonce: string;
  payloadDigest: string | null;
}): string {
  return [
    'rhythm-human-approval-v1',
    input.approvalId,
    input.status,
    input.decisionNonce,
    input.payloadDigest ?? '',
  ].join('\n');
}

export function requireHumanApprovalCapability(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    validateHumanApprovalConfiguration({
      capabilitySha256: env.humanApprovalCapabilitySha256,
      publicKey: env.humanApprovalPublicKey,
    });
    const rawCapability = req.header(HUMAN_APPROVAL_CAPABILITY_HEADER) ?? '';
    const presentedDigest = createHash('sha256')
      .update(rawCapability, 'utf8')
      .digest();
    const configuredDigest = Buffer.from(
      env.humanApprovalCapabilitySha256,
      'hex',
    );
    if (
      presentedDigest.length !== configuredDigest.length ||
      !timingSafeEqual(presentedDigest, configuredDigest)
    ) {
      throw AppError.forbidden('Human approval capability is required');
    }
    next();
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(
            503,
            'HUMAN_APPROVAL_UNAVAILABLE',
            'Human approval verification is unavailable',
          ),
    );
  }
}

export function verifyHumanApprovalSignature(input: {
  approvalId: string;
  status: 'approved' | 'rejected';
  decisionNonce: string;
  payloadDigest: string | null;
  signature: string;
}): boolean {
  try {
    validateHumanApprovalConfiguration({
      capabilitySha256: env.humanApprovalCapabilitySha256,
      publicKey: env.humanApprovalPublicKey,
    });
    const signature = Buffer.from(input.signature, 'base64');
    if (
      signature.length === 0 ||
      signature.toString('base64').replace(/=+$/g, '') !==
        input.signature.trim().replace(/=+$/g, '')
    ) {
      return false;
    }
    return verifySignature(
      'sha256',
      Buffer.from(canonicalHumanApprovalDecision(input), 'utf8'),
      publicKeyFromRawBase64(env.humanApprovalPublicKey),
      signature,
    );
  } catch {
    return false;
  }
}
