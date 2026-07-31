import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import * as tools from '../providers/services/rhythm-tools-service.ts';

function recordingTransport(response = []) {
  const calls = [];
  return {
    calls,
    async request(path, init) {
      calls.push({ path, init });
      return typeof response === 'function'
        ? response(path, init)
        : structuredClone(response);
    },
  };
}

function expectedPairedOperations() {
  return [
    ['GET', '/mobile-gateway/tools/agent-memory'],
    ['GET', '/mobile-gateway/tools/agent-memory/memory-1'],
    ['POST', '/mobile-gateway/tools/agent-memory'],
    ['PATCH', '/mobile-gateway/tools/agent-memory/memory-1'],
    ['DELETE', '/mobile-gateway/tools/agent-memory/memory-1'],
    ['GET', '/mobile-gateway/tools/agent-research'],
    ['GET', '/mobile-gateway/tools/agent-research/research-1'],
    ['POST', '/mobile-gateway/tools/agent-research'],
    ['POST', '/mobile-gateway/tools/agent-research/research-1/retry'],
    ['DELETE', '/mobile-gateway/tools/agent-research/research-1'],
    ['GET', '/mobile-gateway/tools/agent-schedules'],
    ['GET', '/mobile-gateway/tools/agent-schedules/schedule-1'],
    ['POST', '/mobile-gateway/tools/agent-schedules'],
    ['PATCH', '/mobile-gateway/tools/agent-schedules/schedule-1'],
    ['DELETE', '/mobile-gateway/tools/agent-schedules/schedule-1'],
    ['POST', '/mobile-gateway/tools/agent-schedules/schedule-1/trigger-now'],
    ['GET', '/mobile-gateway/tools/agent-webhooks'],
    ['GET', '/mobile-gateway/tools/agent-webhooks/webhook-1'],
    ['POST', '/mobile-gateway/tools/agent-webhooks'],
    ['POST', '/mobile-gateway/tools/agent-webhooks/webhook-1/rotate-secret'],
    ['DELETE', '/mobile-gateway/tools/agent-webhooks/webhook-1'],
    ['GET', '/mobile-gateway/tools/agent-configs'],
    ['GET', '/mobile-gateway/tools/agent-configs/profile-1'],
    ['POST', '/mobile-gateway/tools/agent-configs'],
    ['PATCH', '/mobile-gateway/tools/agent-configs/profile-1'],
    ['POST', '/mobile-gateway/tools/agent-configs/profile-1/resync-agent-file'],
    ['DELETE', '/mobile-gateway/tools/agent-configs/profile-1'],
    ['GET', '/mobile-gateway/tools/agent-cookbook'],
    ['GET', '/mobile-gateway/tools/agent-cookbook/recipe-1'],
    ['POST', '/mobile-gateway/tools/agent-cookbook'],
    ['PATCH', '/mobile-gateway/tools/agent-cookbook/recipe-1'],
    ['DELETE', '/mobile-gateway/tools/agent-cookbook/recipe-1'],
    ['POST', '/mobile-gateway/tools/agent-cookbook/recipe-1/run'],
    ['GET', '/mobile-gateway/tools/agent-org-proposals?status=pending'],
    ['POST', '/mobile-gateway/tools/agent-org-proposals/proposal-1/approve'],
    ['POST', '/mobile-gateway/tools/agent-org-proposals/proposal-1/reject'],
    ['GET', '/mobile-gateway/tools/agents/run-quality?windowDays=30'],
    ['GET', '/mobile-gateway/tools/opencode/skills?withMetadata=true'],
    ['GET', '/mobile-gateway/tools/opencode/skills/skill-1/content'],
    ['POST', '/mobile-gateway/tools/opencode/skills'],
    ['PUT', '/mobile-gateway/tools/opencode/skills/skill-1'],
    ['DELETE', '/mobile-gateway/tools/opencode/skills/skill-1'],
    ['GET', '/mobile-gateway/tools/opencode/commands'],
    ['GET', '/mobile-gateway/tools/opencode/commands/playbook-1/content'],
    ['POST', '/mobile-gateway/tools/opencode/commands'],
    ['PUT', '/mobile-gateway/tools/opencode/commands/playbook-1'],
    ['DELETE', '/mobile-gateway/tools/opencode/commands/playbook-1'],
    ['GET', '/mobile-gateway/opencode/mcp'],
    ['POST', '/mobile-gateway/opencode/mcp'],
    ['POST', '/mobile-gateway/opencode/mcp/mcp-1/connect'],
    ['POST', '/mobile-gateway/opencode/mcp/mcp-1/disconnect'],
    ['POST', '/mobile-gateway/opencode/mcp/mcp-1/auth'],
    ['GET', '/mobile-gateway/opencode/provider'],
    ['GET', '/mobile-gateway/opencode/provider/auth'],
    ['GET', '/mobile-gateway/opencode/config'],
  ];
}

async function invokeEveryPairedOperation(service) {
  await service.listBrain();
  await service.getBrain('memory-1');
  await service.createBrain({ title: 'Memory' });
  await service.updateBrain('memory-1', { title: 'Updated' });
  await service.deleteBrain('memory-1');
  await service.listResearch();
  await service.getResearch('research-1');
  await service.createResearch('Question');
  await service.retryResearch('research-1');
  await service.deleteResearch('research-1');
  await service.listSchedules();
  await service.getSchedule('schedule-1');
  await service.createSchedule({ name: 'Schedule' });
  await service.updateSchedule('schedule-1', { enabled: false });
  await service.deleteSchedule('schedule-1');
  await service.triggerSchedule('schedule-1');
  await service.listWebhooks();
  await service.getWebhook('webhook-1');
  await service.createWebhook({ name: 'Webhook' });
  await service.rotateWebhookSecret('webhook-1');
  await service.revokeWebhook('webhook-1');
  await service.listProfiles();
  await service.getProfile('profile-1');
  await service.createProfile({ label: 'Profile' });
  await service.updateProfile('profile-1', { label: 'Updated' });
  await service.deleteProfile('profile-1');
  await service.listRecipes();
  await service.getRecipe('recipe-1');
  await service.createRecipe({ title: 'Recipe' });
  await service.updateRecipe('recipe-1', { title: 'Updated' });
  await service.deleteRecipe('recipe-1');
  await service.runRecipe('recipe-1');
  await service.listProposals('pending');
  await service.approveProposal('proposal-1');
  await service.rejectProposal('proposal-1', 'No');
  await service.getReportCard();
  await service.listSkills();
  await service.getSkill('skill-1');
  await service.createSkill({ name: 'skill-1' });
  await service.updateSkill('skill-1', { description: 'Updated' });
  await service.deleteSkill('skill-1');
  await service.listPlaybooks();
  await service.getPlaybook('playbook-1');
  await service.createPlaybook({ name: 'playbook-1' });
  await service.updatePlaybook('playbook-1', { description: 'Updated' });
  await service.deletePlaybook('playbook-1');
  await service.listMcp();
  await service.addMcp({ name: 'mcp-1' });
  await service.connectMcp('mcp-1');
  await service.disconnectMcp('mcp-1');
  await service.startMcpOAuth('mcp-1');
  await service.listProviders();
  await service.listProviderAuth();
  await service.getConfig();
}

test('issue-6-c1: every paired Tools operation carries the active project header', async () => {
  // Regression caught: a newly added Tools method bypasses the same project header
  // required by the mobile OpenCode gateway and silently renders an empty screen.
  const cloud = recordingTransport();
  const paired = recordingTransport();
  const service = new tools.RhythmToolsService({
    cloud,
    paired,
    projectId: 'project-alpha',
  });

  await invokeEveryPairedOperation(service);

  assert.deepEqual(
    paired.calls.map(({ path, init }) => [
      init.method ?? 'GET',
      path,
      init.headers?.['X-Rhythm-Project-ID'],
    ]),
    expectedPairedOperations().map(([method, path]) => [
      method,
      path,
      'project-alpha',
    ]),
  );
  assert.equal(cloud.calls.length, 0);
  const [
    chatClientSource,
    toolsServiceSource,
    toolsProviderSource,
    e2eRuntimeSource,
  ] = await Promise.all([
    readFile(new URL('../lib/opencode/client.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../providers/services/rhythm-tools-service.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../providers/rhythm-tools-provider.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../lib/runtime/mobile-runtime.e2e.ts', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(chatClientSource, /withProjectScope\(/);
  assert.match(toolsServiceSource, /withProjectScope\(/);
  assert.match(e2eRuntimeSource, /projectId:\s*'project-demo'/);
  assert.match(e2eRuntimeSource, /error\.code = payload\.error\.code/);
  assert.match(
    toolsProviderSource,
    /if \(e2eService\)\s*\{?\s*return activeProjectPath\s+\?\s+e2eService\s+:\s+e2eService\.forProject\(activeProjectPath\)/,
  );
});

test('issue-6-c2: the Tools inventory covers every screen and required column', async () => {
  // Regression caught: a screen is omitted from the parity review, leaving its
  // ownership or response-shape mismatch undiscovered.
  const inventory = await readFile(
    new URL('../../../docs/ai/mobile-tools-project-scope-inventory.md', import.meta.url),
    'utf8',
  ).catch(() => '');
  for (const heading of [
    'Screen',
    'Mobile endpoint',
    'Desktop path',
    'Response shape',
    'Ownership filter',
    'State handling',
  ]) {
    assert.match(inventory, new RegExp(`\\b${heading}\\b`, 'i'));
  }
  for (const screen of tools.TOOL_SCREEN_MANIFEST) {
    assert.match(inventory, new RegExp(`\\|\\s*${screen.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`));
  }
});

test('issue-6-c3: the service adapter normalizes every Tools response shape', () => {
  // Regression caught: a server envelope or map reaches a screen, where it is
  // mistaken for no rows and displayed as an actual empty result.
  assert.equal(typeof tools.normalizeToolScreenResponse, 'function');
  const normalize = tools.normalizeToolScreenResponse;
  const fixtures = {
    brain: { items: [{ id: 'brain-1', title: 'Memory' }] },
    research: { data: [{ id: 'research-1', query: 'Question' }] },
    schedules: [{ id: 'schedule-1', name: 'Schedule' }],
    webhooks: { items: [{ id: 'webhook-1', name: 'Webhook' }] },
    profiles: [{ id: 'profile-1', label: 'Profile' }],
    cookbook: { data: [{ id: 'recipe-1', title: 'Recipe' }] },
    review: [{ id: 'proposal-1', title: 'Proposal' }],
    'report-card': { agents: [{ agentKind: 'secretary', agentLabel: 'Secretary' }] },
    email: [{ externalId: 'email-1', subject: 'Message' }],
    gallery: { items: [{ id: 'design-1', title: 'Design' }] },
    skills: [{ name: 'skill-1', description: 'Skill' }],
    playbooks: { items: [{ name: 'playbook-1', description: 'Playbook' }] },
    mcp: { rhythm: { status: 'connected' } },
    models: {
      providers: {
        all: [{ id: 'openai', name: 'OpenAI', models: {} }],
        connected: ['openai'],
      },
      auth: { openai: [{ type: 'oauth' }] },
      config: { enabled_providers: ['openai'] },
    },
  };

  for (const screen of tools.TOOL_SCREEN_MANIFEST) {
    const normalized = normalize(screen.id, fixtures[screen.id]);
    assert.equal(normalized.length, 1, `${screen.id} did not normalize one row`);
    assert.equal(typeof normalized[0].id, 'string', `${screen.id} lacks a stable id`);
  }
});

test('issue-6-c4: state classification preserves every required failure mode', async () => {
  // Regression caught: missing/stale project or pairing failures are classified as
  // ordinary empty results, hiding the action the user must take.
  assert.equal(typeof tools.classifyToolFailure, 'function');
  assert.equal(tools.classifyToolFailure(undefined, 'connected'), null);
  assert.equal(tools.classifyToolFailure(undefined, 'missing-scope'), 'missing-scope');
  assert.equal(tools.classifyToolFailure({ status: 404 }, 'connected'), 'stale-project');
  assert.equal(tools.classifyToolFailure({ status: 401 }, 'connected'), 'unauthorized-pairing');
  assert.equal(
    tools.classifyToolFailure(
      { status: 401, code: 'EXPIRED_AUTH' },
      'connected',
    ),
    'expired-auth',
  );
  assert.equal(tools.classifyToolFailure(undefined, 'version-mismatch'), 'version-mismatch');
  assert.equal(tools.classifyToolFailure({ status: 0, retryable: true }, 'connected'), 'network-failure');
  assert.deepEqual(tools.normalizeToolScreenResponse('brain', []), []);
  const toolsProviderSource = await readFile(
    new URL('../providers/rhythm-tools-provider.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    toolsProviderSource,
    /const pairedAvailability:[\s\S]*?!activeProjectPath[\s\S]*?'missing-scope'[\s\S]*?e2eMode[\s\S]*?'connected'[\s\S]*?pairedHost\.state === 'incompatible'/,
  );
});

test('issue-6-c5: project switches cancel old requests and isolate cache scope', async () => {
  // Regression caught: a slow Project A completion wins after Project B is selected
  // or both projects read/write the same persisted Tools cache key.
  let observedSignal;
  const paired = recordingTransport((_path, init) => new Promise((resolve, reject) => {
    observedSignal = init.signal;
    init.signal?.addEventListener(
      'abort',
      () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      { once: true },
    );
  }));
  const service = new tools.RhythmToolsService({
    cloud: recordingTransport(),
    paired,
    projectId: 'project-a',
  });
  assert.equal(typeof service.cancel, 'function');
  const pending = service.listBrain();
  service.cancel();
  await assert.rejects(pending, /aborted/);
  assert.equal(observedSignal?.aborted, true);

  const projectA = tools.deriveToolsCacheScope({
    accountUserId: 7,
    pairedHost: { hostId: 'mac', deviceId: 'phone' },
    runtimeCacheScope: null,
    activeProjectId: 'project-a',
  });
  const projectB = tools.deriveToolsCacheScope({
    accountUserId: 7,
    pairedHost: { hostId: 'mac', deviceId: 'phone' },
    runtimeCacheScope: null,
    activeProjectId: 'project-b',
  });
  assert.notEqual(projectA, projectB);
});

test('issue-6-c6: paired Tools requests fail closed without project scope', async () => {
  // Regression caught: an absent active project silently falls back to a global
  // paired-Mac request and can expose or mutate the wrong project's data.
  const paired = recordingTransport();
  const service = new tools.RhythmToolsService({
    cloud: recordingTransport(),
    paired,
    projectId: '',
  });
  await assert.rejects(service.listBrain(), (error) => {
    assert.equal(error?.kind, 'missing-scope');
    return true;
  });
  assert.equal(paired.calls.length, 0);
});

test('issue-6-c7: provider auth metadata is recursively redacted', () => {
  // Regression caught: nested provider auth metadata containing a credential,
  // token, secret, or API key is copied into provider rows or persisted cache.
  assert.equal(typeof tools.redactProviderAuthMetadata, 'function');
  const redacted = tools.redactProviderAuthMetadata({
    openai: [{
      type: 'oauth',
      label: 'OpenAI',
      token: 'token-value',
      nested: {
        clientSecret: 'secret-value',
        api_key: 'api-key-value',
        instructions: 'Safe instructions',
      },
    }],
  });
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /token-value|secret-value|api-key-value/);
  assert.deepEqual(redacted, {
    openai: [{
      type: 'oauth',
      label: 'OpenAI',
      nested: { instructions: 'Safe instructions' },
    }],
  });
});

test('issue-6-c8: live desktop parity coverage is env gated and documented', async () => {
  // Regression caught: mobile and desktop response shapes drift without any
  // executable comparison path, or a live test runs accidentally in normal CI.
  const [liveTest, inventory] = await Promise.all([
    readFile(new URL('./msp-006-live-parity.test.mjs', import.meta.url), 'utf8').catch(() => ''),
    readFile(
      new URL('../../../docs/ai/mobile-tools-project-scope-inventory.md', import.meta.url),
      'utf8',
    ).catch(() => ''),
  ]);
  assert.match(liveTest, /RHYTHM_LIVE_E2E/);
  assert.match(liveTest, /mobile-gateway/);
  assert.match(liveTest, /desktop/i);
  assert.match(inventory, /RHYTHM_LIVE_E2E=1[\s\S]*msp-006-live-parity\.test\.mjs/);
});
