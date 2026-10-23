import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realpathSync } from 'node:fs';
import { artifactPaths } from './web_paid_custody.mjs';
import { paidRuntimeReadiness } from './run_web_paid.mjs';

function fixture() {
  const identity = (pid, executable) => ({ pid, executable, start: `synthetic-start-${pid}`, uid: process.getuid() });
  const api = identity(21, realpathSync(process.execPath)), engine = identity(22, artifactPaths().engine), holder = identity(20, '/bin/bash');
  return { state: { holderProcess: holder, parent: { pid: 19 } }, observed: {
    apiOk: true, engineOk: true, opencodeStatus: 'ready', hasOwnershipReceipt: false,
    records: { api: 21, engine: 22, holder: 20 }, listeners: { api: [21], engine: [22], gateway: [] },
    processes: { api, engine, holder }, after: { api: { ...api }, engine: { ...engine }, holder: { ...holder } },
    argvBound: { api: true, engine: true, holder: true }, parents: { api: 20, engine: 21, holder: 19 },
  } };
}

test('ordinary canonical paid startup is ready with verified live bindings and no optional recovery receipt', () => {
  const { state, observed } = fixture();
  assert.equal(paidRuntimeReadiness(state, observed), true);
});

test('public health alone cannot admit a paid runtime whose API engine state is not ready', () => {
  const { state, observed } = fixture();
  observed.hasOwnershipReceipt = true; observed.opencodeStatus = 'starting';
  assert.equal(paidRuntimeReadiness(state, observed), false);
});

test('paid readiness refuses mismatched listeners, PID records, executables, kernel start and holder ancestry', () => {
  const mutations = [
    o => { o.listeners.api = [99]; }, o => { o.listeners.engine = [22, 99]; }, o => { o.listeners.gateway = [99]; },
    o => { o.records.api = 99; }, o => { o.records.engine = 99; }, o => { o.records.holder = 99; },
    o => { o.processes.api.executable = '/foreign/node'; }, o => { o.processes.engine.executable = '/foreign/opencode'; },
    o => { o.after.api.start = 'replacement'; }, o => { o.after.engine.start = 'replacement'; }, o => { o.after.holder.start = 'replacement'; },
    o => { o.argvBound.api = false; }, o => { o.argvBound.engine = false; }, o => { o.argvBound.holder = false; },
    o => { o.parents.api = 99; }, o => { o.parents.engine = 99; }, o => { o.parents.holder = 99; },
  ];
  for (const mutate of mutations) {
    const { state, observed } = fixture(); observed.hasOwnershipReceipt = true; mutate(observed);
    assert.throws(() => paidRuntimeReadiness(state, observed), /custody runtime ownership rejected/);
  }
});
