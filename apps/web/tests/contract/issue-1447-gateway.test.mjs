import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('issue-1447-c2: production data and local agent traffic use separate authenticated bases', async () => {
  // Regression caught: tasks and agent sessions both silently use the local SQLite agent server.
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  try {
    const { createLiveGateway } = await vite.ssrLoadModule('/src/gateway/index.ts');
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      requests.push({ url, authorization: headers.get('authorization') ?? undefined });
      const body = url.endsWith('/users/me/preferences')
        ? { artifactTabIds: [] }
        : url.includes('/agent-delegation/status')
          ? { delegations: [] }
          : url.includes('/agents/run-quality')
            ? {}
            : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const gateway = createLiveGateway({
      apiBase: 'http://127.0.0.1:4098',
      engineBase: 'http://127.0.0.1:4097',
      expectedApiBase: 'http://127.0.0.1:4098',
      expectedEngineBase: 'http://127.0.0.1:4097',
      productionApiBase: 'https://api.vcrcapps.com',
      taskToken: 'disposable-contract-token',
    });

    await Promise.all([
      gateway.domains.tasks.list(),
      gateway.domains.dashboard.projectInstances(),
      gateway.domains.planner.taskCollaborators('x'),
      gateway.domains.rhythms.list(),
      gateway.domains.projects.templates(),
      gateway.domains.messages.threads(),
      gateway.domains.facilities.facilities(),
      gateway.domains.automations.triggers(),
      gateway.domains.integrations.accounts(),
      gateway.domains.liveArtifacts.list(),
      gateway.domains.userPreferences.updateArtifactTabIds([]),
      gateway.domains.notifications.list(),
      gateway.domains.sessions.list(),
      gateway.domains.memory.list(),
      gateway.domains.permissions.pending('x'),
      gateway.domains.approvals.listPending(),
      gateway.domains.delegation.status('x'),
      gateway.domains.mcp.list(),
      gateway.domains.skills.list(),
      gateway.domains.schedules.list(),
      gateway.domains.mobileAccess.listDevices(),
      gateway.domains.commands.list(),
      gateway.domains.runQuality.rollup(1),
      gateway.domains.cookbook.list(),
      gateway.domains.research.listProjects(),
      gateway.domains.designs.list(),
    ]);

    assert.deepEqual(requests.map((request) => request.url), [
      'https://api.vcrcapps.com/tasks?status=all',
      'https://api.vcrcapps.com/project-instances',
      'https://api.vcrcapps.com/tasks/x/collaborators',
      'https://api.vcrcapps.com/recurring-rules',
      'https://api.vcrcapps.com/project-templates',
      'https://api.vcrcapps.com/message-threads',
      'https://api.vcrcapps.com/facilities',
      'https://api.vcrcapps.com/automation-catalog/triggers',
      'https://api.vcrcapps.com/integrations/accounts',
      'https://api.vcrcapps.com/live-artifacts?type=html',
      'https://api.vcrcapps.com/users/me/preferences',
      'https://api.vcrcapps.com/notifications',
      'http://127.0.0.1:4098/agent-sessions?scope=chats',
      'http://127.0.0.1:4098/agent-memory',
      'http://127.0.0.1:4098/agent-sessions/x/pending-permissions',
      'http://127.0.0.1:4098/agent-approvals?status=pending',
      'http://127.0.0.1:4098/agent-delegation/status?callerSessionId=x',
      'http://127.0.0.1:4098/opencode/mcp',
      'http://127.0.0.1:4098/opencode/skills',
      'http://127.0.0.1:4098/agent-schedules',
      'http://127.0.0.1:4098/mobile-gateway/devices',
      'http://127.0.0.1:4098/opencode/commands',
      'http://127.0.0.1:4098/agents/run-quality?windowDays=1',
      'http://127.0.0.1:4098/agent-cookbook',
      'http://127.0.0.1:4098/agent-research/projects',
      'http://127.0.0.1:4098/agent-designs',
    ]);
    assert.equal(requests.slice(0, 12).every((request) => request.authorization === 'Bearer disposable-contract-token'), true);
    assert.equal(requests.slice(12).every((request) => request.authorization === undefined), true);

  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});

test('issue-1447-c2: configurable production base accepts servers but rejects unsafe URL forms', async () => {
  // Regression caught: a persisted credential-bearing or non-HTTP URL reaches the renderer fetch boundary.
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { validateProductionApiBase } = await vite.ssrLoadModule('/src/gateway/index.ts');
    assert.equal(validateProductionApiBase('https://api.vcrcapps.com/'), 'https://api.vcrcapps.com');
    assert.equal(validateProductionApiBase('http://rhythm.test/base/'), 'http://rhythm.test/base');
    for (const value of ['', 'file:///tmp/api', 'https://user@api.test', 'https://api.test?token=x', 'https://api.test/#x']) {
      assert.throws(() => validateProductionApiBase(value), /production API base/i);
    }
  } finally {
    await vite.close();
  }
});
