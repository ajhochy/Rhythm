import assert from 'node:assert/strict';
import test from 'node:test';

const policyModule = '../src/artifact-policy.mjs';
const policy = await import(policyModule).catch(() => null);

test('post-m1-p8-c4a: artifact policy exposes only the closed canonical bridge operations', () => {
  // Regression caught: the renderer gains a generic fetch/path/IPC primitive or accepts an
  // undeclared method; module, allowlist, and rejection assertions fail.
  assert.notEqual(policy, null, 'post-m1-p8-c4a: Electron has no artifact-specific policy module');
  if (!policy) return;
  assert.equal(typeof policy.validateArtifactEnvelope, 'function');
  assert.deepEqual(policy.ARTIFACT_METHODS, ['state.get', 'state.update', 'pco.services.read', 'host.blocked']);
  const accepted = policy.validateArtifactEnvelope({
    id: 'phase8_request-1', method: 'state.get', params: {}, nonce: 'unguessable-document-nonce',
  });
  assert.equal(accepted.ok, true);
  for (const method of ['fetch', 'url.open', 'filesystem.read', 'shell.exec', 'clipboard.read', 'popup.open', 'navigate', 'download']) {
    assert.equal(
      policy.validateArtifactEnvelope({ id: 'phase8_request-1', method, params: {}, nonce: 'unguessable-document-nonce' }).ok,
      false,
      `post-m1-p8-c4a: generic method ${method} escaped the allowlist`,
    );
  }
  assert.equal(
    policy.validateArtifactEnvelope({ id: 'phase8_request-1', method: 'state.get', params: {}, nonce: 'unguessable-document-nonce', url: 'https://example.invalid' }).ok,
    false,
    'post-m1-p8-c4a: an envelope with non-canonical keys was accepted',
  );
});

test('post-m1-p8-c4b: artifact bridge policy binds nonce, request IDs, payload, concurrency, and generation', () => {
  // Regression caught: a stale document reuses an ID/nonce or floods the host after identity/tab
  // change; exact validation, duplicate, capacity, and lifecycle assertions fail.
  assert.notEqual(policy, null, 'post-m1-p8-c4b: Electron has no artifact-specific policy module');
  if (!policy) return;
  assert.equal(typeof policy.createArtifactRequestPolicy, 'function');
  const guard = policy.createArtifactRequestPolicy({
    artifactId: '00000000-0000-4000-8000-000000000811',
    userId: 81,
    documentNonce: 'unguessable-document-nonce',
    rendererGeneration: 4,
  });
  const envelope = (id, params = {}) => ({ id, method: 'state.get', params, nonce: 'unguessable-document-nonce' });
  assert.equal(guard.accept(envelope('A_1')).ok, true);
  assert.equal(guard.accept(envelope('A_1')).ok, false, 'duplicate request IDs must be rejected');
  for (const invalid of ['', 'spaces are invalid', 'x'.repeat(65), '../escape']) {
    assert.equal(guard.accept(envelope(invalid)).ok, false, `invalid request id ${JSON.stringify(invalid)} was accepted`);
  }
  assert.equal(guard.accept(envelope('oversize', { payload: 'x'.repeat(64 * 1024) })).ok, false, 'payload over 64 KiB was accepted');
  const capacity = policy.createArtifactRequestPolicy({ artifactId: '00000000-0000-4000-8000-000000000811', userId: 81, documentNonce: 'nonce-2', rendererGeneration: 4 });
  for (let index = 0; index < 8; index += 1) {
    assert.equal(capacity.accept({ id: `request_${index}`, method: 'state.get', params: {}, nonce: 'nonce-2' }).ok, true);
  }
  assert.equal(capacity.accept({ id: 'request_8', method: 'state.get', params: {}, nonce: 'nonce-2' }).ok, false, 'ninth in-flight request was accepted');
  assert.equal(guard.accept(envelope('wrong-nonce'), { documentNonce: 'stale' }).ok, false);
  assert.equal(guard.settle('A_1', { artifactId: artifactIdForTest(), userId: 81, rendererGeneration: 4 }).deliver, true);
  assert.equal(guard.settle('A_1', { artifactId: artifactIdForTest(), userId: 82, rendererGeneration: 4 }).deliver, false);
  assert.equal(guard.settle('A_1', { artifactId: artifactIdForTest(), userId: 81, rendererGeneration: 5 }).deliver, false);
  assert.equal(guard.settle('A_1', { artifactId: '00000000-0000-4000-8000-000000000999', userId: 81, rendererGeneration: 4 }).deliver, false);
});

function artifactIdForTest() {
  return '00000000-0000-4000-8000-000000000811';
}
