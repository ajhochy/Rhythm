import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  RhythmToolsService,
  sanitizeToolCache,
  TOOL_SCREEN_MANIFEST,
} from '../../providers/services/rhythm-tools-service.ts';

const toolScreenSource = await readFile(
  new URL('../../app/tools/[tool].tsx', import.meta.url),
  'utf8',
);
const toolsProviderSource = await readFile(
  new URL('../../providers/rhythm-tools-provider.tsx', import.meta.url),
  'utf8',
);
const toolStateSource = await readFile(
  new URL('../../components/tools/tool-screen-state.tsx', import.meta.url),
  'utf8',
);

const pairedTools = [
  'brain',
  'research',
  'schedules',
  'webhooks',
  'profiles',
  'cookbook',
  'review',
  'report-card',
  'skills',
  'playbooks',
  'mcp',
  'models',
];

function recordingTransport(origin) {
  const calls = [];
  return {
    calls,
    async request(path, init) {
      calls.push({ origin, path, init });
      return [];
    },
  };
}

test('issue-1173-c1: Email and Gallery use production cloud transport independently of the paired Mac', async () => {
  // Regression caught: either production-owned screen is accidentally routed through
  // the paired transport and becomes unusable when that Mac is offline.
  const cloud = recordingTransport('cloud');
  const paired = recordingTransport('paired');
  const service = new RhythmToolsService({
    cloud,
    paired,
    projectId: 'project-test',
  });

  await service.listEmailSignals();
  await service.listGalleryDesigns();

  assert.deepEqual(
    cloud.calls.map(({ path }) => path),
    ['/integrations/gmail-signals?limit=20', '/agent-designs'],
  );
  assert.equal(paired.calls.length, 0);
  assert.deepEqual(
    TOOL_SCREEN_MANIFEST
      .filter(({ id }) => ['email', 'gallery'].includes(id))
      .map(({ id, origin }) => [id, origin]),
    [
      ['email', 'cloud'],
      ['gallery', 'cloud'],
    ],
  );
});

test('issue-1173-c2: every paired-Mac tool has a secret-free read-only offline cache', () => {
  // Regression caught: a newly added paired screen persists a credential-like field,
  // or the provider permits a mutation while the paired service is unavailable.
  for (const tool of pairedTools) {
    const cached = sanitizeToolCache(tool, [{
      id: `${tool}-fixture`,
      agentKind: `${tool}-fixture`,
      name: `${tool}-fixture`,
      title: `${tool} fixture`,
      label: `${tool} fixture`,
      authorization: 'Bearer must-not-persist',
      apiKey: 'must-not-persist',
      credential: 'must-not-persist',
      oauthToken: 'must-not-persist',
      password: 'must-not-persist',
      secret: 'must-not-persist',
      token: 'must-not-persist',
    }]);
    assert.doesNotMatch(
      JSON.stringify(cached),
      /must-not-persist/,
      `${tool} persisted a sensitive field`,
    );
    assert.equal(cached.length, 1, `${tool} lost its safe cached record`);
  }
  assert.match(
    toolsProviderSource,
    /if \(!service \|\| availabilityFor\(tool\) !== 'connected'\)[\s\S]*?read-only while its service is offline/,
  );
});

test('issue-1173-c3: webhook secrets are held for one-time display and excluded from persistence', () => {
  // Regression caught: a create/rotate secret is copied into the persisted tool cache
  // or remains visible after the user dismisses the one-time disclosure.
  const cached = sanitizeToolCache('webhooks', [{
    id: 'webhook-fixture',
    name: 'Fixture webhook',
    url: 'https://example.test/webhooks/fixture',
    secret: 'one-time-secret',
    signingSecret: 'nested-one-time-secret',
  }]);

  assert.doesNotMatch(JSON.stringify(cached), /one-time-secret/);
  assert.match(toolScreenSource, /setOneTimeSecret\(secret\)/);
  assert.match(toolScreenSource, /This secret is shown once and is never saved on this device\./);
  assert.match(toolScreenSource, /onPress=\{\(\) => setOneTimeSecret\(null\)\}>I saved it/);
});

test('issue-1173-c4: profile scope preserves null versus empty and projection completes before refresh', async () => {
  // Regression caught: inherited scope is serialized as an empty deny-list, or refresh
  // races ahead of the agent-file projection request.
  assert.match(
    toolScreenSource,
    /form\.scopeMode === 'inherit'\s*\?\s*null\s*:\s*form\.scopeMode === 'explicit-empty'\s*\?\s*'\[\]'/,
  );

  const cloud = recordingTransport('cloud');
  const paired = recordingTransport('paired');
  const service = new RhythmToolsService({
    cloud,
    paired,
    projectId: 'project-test',
  });
  await service.updateProfile('secretary', { allowedMcpsJson: null });
  await service.updateProfile('secretary', { allowedMcpsJson: '[]' });

  assert.deepEqual(
    paired.calls.map(({ path, init }) => [init.method, path, init.body ?? null]),
    [
      [
        'PATCH',
        '/mobile-gateway/tools/agent-configs/secretary',
        JSON.stringify({ allowedMcpsJson: null }),
      ],
      [
        'POST',
        '/mobile-gateway/tools/agent-configs/secretary/resync-agent-file',
        null,
      ],
      [
        'PATCH',
        '/mobile-gateway/tools/agent-configs/secretary',
        JSON.stringify({ allowedMcpsJson: '[]' }),
      ],
      [
        'POST',
        '/mobile-gateway/tools/agent-configs/secretary/resync-agent-file',
        null,
      ],
    ],
  );
  assert.match(
    toolsProviderSource,
    /const result = await runAction\(service, action, input\);\s*await refresh\(tool\);/,
  );
});

test('issue-1173-c5: every destructive run-now or high-risk tool action is confirmation guarded', () => {
  // Regression caught: a dangerous action is wired directly to run() and can execute
  // with a single accidental tap.
  const requiredConfirmations = [
    ['brain', 'Delete memory?'],
    ['research', 'Delete research?'],
    ['schedules', 'Run scheduled job?'],
    ['schedules', 'Delete scheduled job?'],
    ['webhooks', 'Rotate webhook secret?'],
    ['webhooks', 'Delete webhook?'],
    ['profiles', 'Delete profile?'],
    ['cookbook', 'Run recipe?'],
    ['cookbook', 'Delete recipe?'],
    ['review', 'Approve high-risk proposal?'],
    ['skills', 'Delete skill?'],
    ['playbooks', 'Delete playbook?'],
    ['mcp', 'Remove MCP authorization?'],
    ['models', 'Remove provider credentials?'],
  ];

  for (const [tool, prompt] of requiredConfirmations) {
    assert.match(
      toolScreenSource,
      new RegExp(`confirmAction\\(\\s*['"]${prompt.replace(/[?]/g, '\\?')}['"]`),
      `${tool} is missing its confirmation prompt`,
    );
  }
});

test('issue-1173-c6: all fourteen tool screens handle every resilient state', () => {
  // Regression caught: a tool is added to navigation without loading, empty,
  // scoped-failure, offline, auth, or server-error handling.
  const expectedTools = [
    'brain',
    'research',
    'schedules',
    'webhooks',
    'profiles',
    'cookbook',
    'review',
    'report-card',
    'email',
    'gallery',
    'skills',
    'playbooks',
    'mcp',
    'models',
  ];
  const expectedStates = [
    'loading',
    'empty',
    'offline-cache',
    'missing-scope',
    'stale-project',
    'unauthorized-pairing',
    'version-mismatch',
    'network-failure',
    'expired-auth',
    'forbidden',
    'error',
  ];

  assert.deepEqual(TOOL_SCREEN_MANIFEST.map(({ id }) => id), expectedTools);
  for (const screen of TOOL_SCREEN_MANIFEST) {
    assert.deepEqual(screen.states, expectedStates, `${screen.id} has incomplete state coverage`);
  }
  for (const state of expectedStates) {
    assert.match(
      toolStateSource,
      new RegExp(`['"]${state}['"]`),
      `the shared state component does not render ${state}`,
    );
  }
});
