import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSecuritySmokeReceipt } from '../src/security-smoke-receipt.mjs';

const validReceipt = {
  bridge: {
    keys: ['version', 'appVersion', 'platform', 'gateway', 'auth', 'humanApproval', 'agentServer'],
    frozen: true,
    gateway: {
      keys: ['apiBase', 'engineBase', 'productionApiBase', 'setProductionApiBase'],
      frozen: true,
    },
    auth: { keys: ['signInWithGoogle'], frozen: true },
    humanApproval: { keys: ['capability', 'signDecision'], frozen: true },
    agentServer: { keys: ['status', 'onStatusChange'], frozen: true },
    nodeExposed: false,
    value: { version: 5 },
  },
  denials: {
    navigation: true,
    popup: true,
    permission: true,
    download: true,
    malformedProtocol: true,
  },
};

test('signed security smoke accepts the exact hardened bridge and denial receipt', () => {
  assert.deepEqual(validateSecuritySmokeReceipt(validReceipt), { ok: true });
});

test('signed security smoke rejects every unsafe bridge and denial invariant', () => {
  const invalidMutations = [
    (receipt) => { receipt.bridge.nodeExposed = true; },
    (receipt) => { receipt.bridge.keys.push('filesystem'); },
    (receipt) => { receipt.bridge.frozen = false; },
    (receipt) => { receipt.bridge.gateway.keys.push('fetch'); },
    (receipt) => { receipt.bridge.gateway.frozen = false; },
    (receipt) => { receipt.bridge.auth.keys.push('token'); },
    (receipt) => { receipt.bridge.auth.frozen = false; },
    (receipt) => { receipt.bridge.humanApproval.keys.push('signBytes'); },
    (receipt) => { receipt.bridge.humanApproval.frozen = false; },
    (receipt) => { receipt.bridge.agentServer.keys.push('spawn'); },
    (receipt) => { receipt.bridge.agentServer.frozen = false; },
    (receipt) => { receipt.bridge.value.version = '5'; },
    (receipt) => { receipt.denials.navigation = false; },
    (receipt) => { receipt.denials.popup = false; },
    (receipt) => { receipt.denials.permission = false; },
    (receipt) => { receipt.denials.download = false; },
    (receipt) => { receipt.denials.malformedProtocol = false; },
  ];

  for (const mutate of invalidMutations) {
    const receipt = structuredClone(validReceipt);
    mutate(receipt);
    const result = validateSecuritySmokeReceipt(receipt);
    assert.equal(result.ok, false, `unsafe receipt passed: ${JSON.stringify(receipt)}`);
    assert.equal(typeof result.reason, 'string');
  }
  assert.equal(validateSecuritySmokeReceipt(null).ok, false);
});
