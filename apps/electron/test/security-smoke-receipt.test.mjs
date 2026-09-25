import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  AGENT_SERVER_KEYS, AI_ACCOUNTS_KEYS, AUTH_KEYS, BRIDGE_KEYS, COLONY_VIEW_KEYS,
  GATEWAY_KEYS, HERMES_KEYS, HERMES_VIEW_KEYS, HUMAN_APPROVAL_KEYS, UPDATE_KEYS,
  validateSecuritySmokeReceipt,
} from '../src/security-smoke-receipt.mjs';

const validReceipt = {
  bridge: {
    keys: BRIDGE_KEYS,
    frozen: true,
    gateway: {
      keys: GATEWAY_KEYS,
      frozen: true,
    },
    auth: { keys: AUTH_KEYS, frozen: true },
    humanApproval: { keys: HUMAN_APPROVAL_KEYS, frozen: true },
    agentServer: { keys: AGENT_SERVER_KEYS, frozen: true },
    hermes: { keys: HERMES_KEYS, frozen: true },
    hermesView: { keys: HERMES_VIEW_KEYS, frozen: true },
    colonyView: { keys: COLONY_VIEW_KEYS, frozen: true },
    aiAccounts: { keys: AI_ACCOUNTS_KEYS, frozen: true },
    updates: { keys: UPDATE_KEYS, frozen: true },
    nodeExposed: false,
    value: { version: 6 },
  },
  denials: {
    navigation: true,
    popup: true,
    permission: true,
    download: true,
    malformedProtocol: true,
  },
};

async function receiptFromRealPreload() {
  let bridge;
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'rhythmShell'); bridge = value; } },
        ipcRenderer: { invoke: async () => undefined, on() {}, send() {}, sendSync: () => 'https://example.invalid' },
      };
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
  });
  const keys = (value) => ({ keys: Object.keys(value), frozen: Object.isFrozen(value) });
  return {
    bridge: {
      ...keys(bridge),
      gateway: keys(bridge.gateway),
      auth: keys(bridge.auth),
      humanApproval: keys(bridge.humanApproval),
      agentServer: keys(bridge.agentServer),
      hermes: keys(bridge.hermes),
      hermesView: keys(bridge.hermesView),
      colonyView: keys(bridge.colonyView),
      aiAccounts: keys(bridge.aiAccounts),
      updates: keys(bridge.updates),
      nodeExposed: false,
      value: { version: bridge.version },
    },
    denials: structuredClone(validReceipt.denials),
  };
}

test('issue-1542-c12: signed security smoke accepts both exact Hermes bridge receipts', () => {
  assert.deepEqual(validateSecuritySmokeReceipt(validReceipt), { ok: true });
});

test('review:security-smoke-receipt.mjs:5 validates the real preload closed surface', async () => {
  assert.deepEqual(validateSecuritySmokeReceipt(await receiptFromRealPreload()), { ok: true });
});

test('review:security-smoke-receipt.mjs:5 rejects an unexpected real agentServer capability', async () => {
  const receipt = await receiptFromRealPreload();
  receipt.bridge.agentServer.keys.push('unexpected');
  assert.deepEqual(validateSecuritySmokeReceipt(receipt), {
    ok: false,
    reason: 'bridge.agentServer.keys does not match the closed capability surface',
  });
});

test('review:security-smoke-receipt.mjs:5 rejects an unexpected real colonyView capability', async () => {
  const receipt = await receiptFromRealPreload();
  receipt.bridge.colonyView.keys.push('unexpected');
  assert.deepEqual(validateSecuritySmokeReceipt(receipt), {
    ok: false,
    reason: 'bridge.colonyView.keys does not match the closed capability surface',
  });
});

test('signed security smoke rejects every unsafe bridge and denial invariant', () => {
  const invalidMutations = [
    (receipt) => { receipt.bridge.nodeExposed = true; },
    (receipt) => { receipt.bridge.keys.push('filesystem'); },
    (receipt) => { receipt.bridge.keys = receipt.bridge.keys.filter((key) => key !== 'selectDirectory'); },
    (receipt) => { receipt.bridge.frozen = false; },
    (receipt) => { receipt.bridge.gateway.keys.push('fetch'); },
    (receipt) => { receipt.bridge.gateway.frozen = false; },
    (receipt) => { receipt.bridge.auth.keys.push('token'); },
    (receipt) => { receipt.bridge.auth.frozen = false; },
    (receipt) => { receipt.bridge.humanApproval.keys.push('signBytes'); },
    (receipt) => { receipt.bridge.humanApproval.frozen = false; },
    (receipt) => { receipt.bridge.agentServer.keys.push('spawn'); },
    (receipt) => { receipt.bridge.agentServer.frozen = false; },
    (receipt) => { receipt.bridge.hermes.keys.push('token'); },
    (receipt) => { receipt.bridge.hermes.frozen = false; },
    (receipt) => { receipt.bridge.hermesView.keys.push('token'); },
    (receipt) => { receipt.bridge.hermesView.frozen = false; },
    (receipt) => { receipt.bridge.colonyView.frozen = false; },
    (receipt) => { receipt.bridge.updates.keys.push('install'); },
    (receipt) => { receipt.bridge.updates.frozen = false; },
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

test('Accounts receipt requires the exact frozen metadata-only bridge', () => {
  for (const accounts of [undefined, { keys: AI_ACCOUNTS_KEYS, frozen: false }, { keys: [...AI_ACCOUNTS_KEYS, 'readKey'], frozen: true }]) {
    const receipt = structuredClone(validReceipt);
    receipt.bridge.aiAccounts = accounts;
    assert.equal(validateSecuritySmokeReceipt(receipt).ok, false);
  }
});
