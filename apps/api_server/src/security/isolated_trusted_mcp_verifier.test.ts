import assert from 'node:assert/strict';
import { afterEach, it } from 'vitest';
import {
  clearTrustedMcpVerifier,
  createIsolatedTrustedMcpVerifier,
  pinTrustedMcpPublicKey,
  verifyTrustedMcpCall,
} from './trusted_mcp_call';
import { createTrustedMcpTestSigner } from '../__tests__/helpers/trusted_mcp_test_proof';

afterEach(() => clearTrustedMcpVerifier());
it('isolates engine keys and replay state across private and live verifiers', async () => {
const tool = 'rhythm_run_managed_tool';
const identity = { sdkSessionId: 'private-sdk', turnId: 'private-turn', agentName: 'private-agent', toolCallId: 'private-call' };
const args = { proposalId: 'owned-proposal', argv: ['--version'] };
const now = Date.now();
const liveSigner = createTrustedMcpTestSigner();
const privateSignerA = createTrustedMcpTestSigner();
const privateSignerB = createTrustedMcpTestSigner();
pinTrustedMcpPublicKey(liveSigner.publicDocument);
const liveCall = liveSigner.signCall(identity, tool, args, now);
assert.deepEqual(await verifyTrustedMcpCall(liveCall, tool, now), { context: identity, arguments: args });

const privateA = createIsolatedTrustedMcpVerifier(privateSignerA.publicDocument);
const privateB = createIsolatedTrustedMcpVerifier(privateSignerB.publicDocument);
const aCall = privateSignerA.signCall(identity, tool, args, now);
const bCall = privateSignerB.signCall(identity, tool, args, now);
assert.deepEqual(await privateA.verify(aCall, tool, now), { context: identity, arguments: args });
assert.deepEqual(await privateB.verify(bCall, tool, now), { context: identity, arguments: args });
await assert.rejects(privateA.verify(bCall, tool, now), /key is unavailable/);
await assert.rejects(privateB.verify(aCall, tool, now), /key is unavailable/);
await assert.rejects(privateA.verify(aCall, tool, now), /already consumed/);
await assert.rejects(privateB.verify(bCall, tool, now), /already consumed/);

const tampered = privateSignerA.signCall(identity, tool, args, now);
tampered.arguments = { ...args, argv: ['--help'] };
await assert.rejects(privateA.verify(tampered, tool, now), /payload mismatch/);
const wrongTool = privateSignerA.signCall(identity, tool, args, now);
await assert.rejects(privateA.verify(wrongTool, 'rhythm_list_managed_tools', now), /payload mismatch/);
const expired = privateSignerA.signCall(identity, tool, args, now - 61_000);
await assert.rejects(privateA.verify(expired, tool, now), /expired/);
privateA.dispose();
await assert.rejects(privateA.verify(privateSignerA.signCall(identity, tool, args, now), tool, now), /key is unavailable/);

// Creating and using disposable verifiers must neither rotate nor consume the live verifier.
await assert.rejects(verifyTrustedMcpCall(liveCall, tool, now), /already consumed/);
const anotherLiveCall = liveSigner.signCall(identity, tool, args, now);
assert.deepEqual(await verifyTrustedMcpCall(anotherLiveCall, tool, now), { context: identity, arguments: args });
await assert.rejects(verifyTrustedMcpCall(aCall, tool, now), /key is unavailable/);
clearTrustedMcpVerifier();
});
