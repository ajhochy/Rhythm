// Main-process counterpart to apps/web/src/security/humanApprovalSigner.ts's renderer-side Web
// Crypto signer, and the piece that makes the two ends of the P-256 decision-signature contract
// (apps/api_server/src/security/human_approval_security.ts) actually agree: whichever process
// SPAWNS api_server is the one that must hand it HUMAN_APPROVAL_PUBLIC_KEY /
// HUMAN_APPROVAL_CAPABILITY_SHA256, mirroring apps/desktop_flutter/lib/app/core/server/
// api_server_service.dart:46-92,186-283 (Flutter calls its native HumanApprovalSigner right before
// spawning, for the exact same reason). agent-server.mjs calls this module before every spawn.
//
// Key storage: macOS Keychain via the `security` CLI, the same pattern already used elsewhere in
// this repo (apps/api_server/src/services/credentials_bridge_service.ts:327's
// `security find-generic-password`). ponytail: the private key briefly exists as an argv-passed PEM
// during `security add-generic-password`, and Node has no Secure-Enclave-backed SecKey equivalent
// without a native addon — a real, smaller ceiling than Flutter's Secure-Enclave-when-available
// SecKey (apps/desktop_flutter/macos/Runner/HumanApprovalSigner.swift:93-115). Escalate to a native
// Node addon or an Electron-specific keytar-like module if that gap needs closing later.
import { execFile } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as cryptoSign, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

const KEYCHAIN_SERVICE = 'rhythm-electron-human-approval-key';
const KEYCHAIN_ACCOUNT = 'signing-key-v1';
const CAPABILITY_SERVICE = 'rhythm-electron-human-approval-capability';
const CAPABILITY_ACCOUNT = 'capability-v1';
// Matches apps/api_server/src/security/human_approval_security.ts:60-73 exactly.
const CANONICAL_PREFIX = 'rhythm-human-approval-v1';

/** @param {string} service @param {string} account @returns {Promise<string | null>} */
async function keychainRead(service, account) {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

/** @param {string} service @param {string} account @param {string} value */
async function keychainWrite(service, account, value) {
  // -U: update in place if an entry already exists, instead of erroring.
  await run('security', ['add-generic-password', '-U', '-s', service, '-a', account, '-w', value]);
}

/** @type {{ privateKey: import('node:crypto').KeyObject, publicKey: import('node:crypto').KeyObject } | undefined} */
let cachedKeyPair;

async function getOrCreateKeyPair() {
  if (cachedKeyPair) return cachedKeyPair;
  const existingEncoded = await keychainRead(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (existingEncoded) {
    // `security find-generic-password -w` silently switches to hex-encoded output whenever the
    // stored value contains embedded newlines (a PEM always does) — confirmed empirically, not
    // documented. Storing/reading base64 (single line, no newlines) sidesteps that entirely rather
    // than trying to detect and un-hex-encode after the fact.
    const privateKey = createPrivateKey(Buffer.from(existingEncoded, 'base64').toString('utf8'));
    const publicKey = createPublicKey(privateKey);
    cachedKeyPair = { privateKey, publicKey };
    return cachedKeyPair;
  }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf8');
  await keychainWrite(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, Buffer.from(pem, 'utf8').toString('base64'));
  cachedKeyPair = { privateKey, publicKey };
  return cachedKeyPair;
}

/** @type {string | undefined} */
let cachedCapability;

async function getOrCreateCapability() {
  if (cachedCapability) return cachedCapability;
  const existing = await keychainRead(CAPABILITY_SERVICE, CAPABILITY_ACCOUNT);
  if (existing) { cachedCapability = existing; return existing; }
  const value = randomBytes(32).toString('base64url');
  await keychainWrite(CAPABILITY_SERVICE, CAPABILITY_ACCOUNT, value);
  cachedCapability = value;
  return value;
}

// The exact 65-byte uncompressed SEC1 point (0x04 || X || Y) publicKeyFromRawBase64 expects at
// apps/api_server/src/security/human_approval_security.ts:24-46. JWK export gives base64url x/y
// directly — far more robust than hand-parsing SPKI DER offsets for one fixed curve.
/** @param {import('node:crypto').KeyObject} publicKey */
function publicKeyRawBase64(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('EC public key JWK export is missing x/y coordinates');
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64');
}

/** Called before every spawn — the exact two values api_server's env needs (post-m1-p7-c4d). */
export async function capabilityMaterial() {
  const [{ publicKey }, capabilitySha256] = await Promise.all([
    getOrCreateKeyPair(),
    getOrCreateCapability().then((value) => createHash('sha256').update(value, 'utf8').digest('hex')),
  ]);
  return { humanApprovalPublicKey: publicKeyRawBase64(publicKey), humanApprovalCapabilitySha256: capabilitySha256 };
}

/** Exposed to the renderer via IPC — narrow surface only (never the private key itself). */
export async function capability() {
  return getOrCreateCapability();
}

/**
 * Exposed to the renderer via IPC — narrow surface only (post-m1-p7-c4e: no arbitrary-sign primitive).
 * @param {{ approvalId: string, status: 'approved' | 'rejected', decisionNonce: string, payloadDigest: string | null }} decision
 */
export async function signDecision({ approvalId, status, decisionNonce, payloadDigest }) {
  const { privateKey } = await getOrCreateKeyPair();
  const canonical = [CANONICAL_PREFIX, approvalId, status, decisionNonce, payloadDigest ?? ''].join('\n');
  // Node's crypto.sign for an EC key defaults to ASN.1 DER — exactly what
  // human_approval_security.ts's crypto.verify expects, no P1363 conversion needed here (unlike
  // the renderer's Web Crypto fallback, which emits raw P1363 and must convert).
  const signature = cryptoSign('sha256', Buffer.from(canonical, 'utf8'), privateKey);
  return { capability: await getOrCreateCapability(), signature: signature.toString('base64') };
}
