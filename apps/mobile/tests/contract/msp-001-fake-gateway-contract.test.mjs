import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  profileCatalogPayload,
  resolveMobileSessionExecutionState,
} from '../fake-opencode/fixtures.mjs';

const serverSource = await readFile(
  new URL('../fake-opencode/server.mjs', import.meta.url),
  'utf8',
);

test('msp-001 fake gateway exposes only the safe profile projection', () => {
  const catalog = profileCatalogPayload();
  assert.deepEqual(
    Object.keys(catalog.profiles[0]).sort(),
    ['defaults', 'display', 'name', 'opencodeAgentId', 'profileId'],
  );
  const serialized = JSON.stringify(catalog).toLowerCase();
  for (const forbidden of [
    'prompt',
    'credential',
    'token',
    'apikey',
    'delegate',
    'environment',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.match(
    serverSource,
    /gatewayPath === '\/mobile-gateway\/profile-catalog'/,
  );
});

test('msp-001 fake gateway resolves profile identity and rejects mismatches', () => {
  const input = {
    profileId: 'profile-build',
    opencodeAgentId: 'build',
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    thinkingBudget: null,
    permissionMode: 'default',
  };
  assert.deepEqual(
    resolveMobileSessionExecutionState(input, 'session-1'),
    {
      statusCode: 200,
      state: {
        localSessionId: 'local-session-1',
        profileId: 'profile-build',
        opencodeAgentId: 'build',
        profileAvailability: 'available',
        providerId: 'openai',
        modelId: 'gpt-4.1-mini',
        thinkingBudget: null,
        permissionMode: 'default',
      },
    },
  );
  assert.equal(
    resolveMobileSessionExecutionState(
      { ...input, opencodeAgentId: 'secretary' },
      'session-1',
    ).statusCode,
    400,
  );
  assert.equal(
    resolveMobileSessionExecutionState(
      { ...input, profileId: 'missing-profile' },
      'session-1',
    ).statusCode,
    404,
  );
});

test('msp-001 fake gateway preserves explicit unassigned session state', () => {
  const resolved = resolveMobileSessionExecutionState(
    {
      profileId: null,
      opencodeAgentId: null,
      providerId: null,
      modelId: null,
      thinkingBudget: null,
      permissionMode: 'plan',
    },
    'session-2',
  );
  assert.deepEqual(resolved.state, {
    localSessionId: 'local-session-2',
    profileId: null,
    opencodeAgentId: null,
    profileAvailability: 'unassigned',
    providerId: null,
    modelId: null,
    thinkingBudget: null,
    permissionMode: 'plan',
  });
  assert.match(
    serverSource,
    /session\.rhythm = resolved\.state/,
  );
});
