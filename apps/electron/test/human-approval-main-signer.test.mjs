// Reconstructs (does not import — apps/api_server is a separate TypeScript package) the exact
// server-side verification apps/api_server/src/security/human_approval_security.ts:24-46,60-73,
// 127-156 performs, so this proves the real cryptographic contract round-trips rather than just
// that signDecision() returns *a* string. A wrong DER/JWK/canonical-string detail here would pass
// a test that merely checks `typeof signature === 'string'` and fail against the real server.
import assert from 'node:assert/strict';
import { createPublicKey, createHash, verify as cryptoVerify } from 'node:crypto';
import test from 'node:test';
import { capability, capabilityMaterial, signDecision } from '../src/human-approval-main-signer.mjs';

// These contracts deliberately exercise the real login Keychain. Keep them out of the canonical
// unit suite so HOME-isolated smoke/CI runs cannot create or update production-named entries.
const keychainIntegrationTest = process.env.RHYTHM_KEYCHAIN_INTEGRATION_TEST === '1'
  ? test
  : test.skip;

/** apps/api_server/src/security/human_approval_security.ts:24-46. */
function publicKeyFromRawBase64(rawBase64) {
  const raw = Buffer.from(rawBase64, 'base64');
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 0x04);
  const x = raw.subarray(1, 33).toString('base64url');
  const y = raw.subarray(33, 65).toString('base64url');
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
}

/** apps/api_server/src/security/human_approval_security.ts:60-73. */
function canonicalHumanApprovalDecision({ approvalId, status, decisionNonce, payloadDigest }) {
  return ['rhythm-human-approval-v1', approvalId, status, decisionNonce, payloadDigest ?? ''].join('\n');
}

keychainIntegrationTest('post-m1-p7-c4d human-approval-main-signer: signDecision produces a signature the server-shape verifier accepts', async () => {
  const material = await capabilityMaterial();
  const decision = { approvalId: 'approval-test-1', status: 'approved', decisionNonce: 'nonce-test-1', payloadDigest: 'digest-test-1' };
  const signed = await signDecision(decision);

  const publicKey = publicKeyFromRawBase64(material.humanApprovalPublicKey);
  const canonical = canonicalHumanApprovalDecision(decision);
  const verified = cryptoVerify('sha256', Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signed.signature, 'base64'));
  assert.equal(verified, true, 'signature must verify against the exact public key capabilityMaterial() reports');

  // A signature over the WRONG canonical string (e.g. a tampered status) must NOT verify — proves
  // this isn't a signature that happens to verify against anything.
  const tamperedCanonical = canonicalHumanApprovalDecision({ ...decision, status: 'rejected' });
  const forgedVerified = cryptoVerify('sha256', Buffer.from(tamperedCanonical, 'utf8'), publicKey, Buffer.from(signed.signature, 'base64'));
  assert.equal(forgedVerified, false, 'a signature over one decision must not verify for a different one');
});

keychainIntegrationTest('post-m1-p7-c4d human-approval-main-signer: capabilitySha256 matches sha256(capability())', async () => {
  const [material, rawCapability] = await Promise.all([capabilityMaterial(), capability()]);
  assert.equal(material.humanApprovalCapabilitySha256, createHash('sha256').update(rawCapability, 'utf8').digest('hex'));
});

keychainIntegrationTest('post-m1-p7-c4d human-approval-main-signer: capability and key are stable across calls (Keychain-persisted, not regenerated per call)', async () => {
  const [first, second] = await Promise.all([capabilityMaterial(), capabilityMaterial()]);
  assert.equal(first.humanApprovalPublicKey, second.humanApprovalPublicKey);
  assert.equal(first.humanApprovalCapabilitySha256, second.humanApprovalCapabilitySha256);
});
