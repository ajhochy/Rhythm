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

    assert.deepEqual(requests, [
      { url: 'https://api.vcrcapps.com/tasks?status=all', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/project-instances', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/tasks/x/collaborators', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/recurring-rules', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/project-templates', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/message-threads', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/facilities', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/automation-catalog/triggers', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/integrations/accounts', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/live-artifacts?type=html', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/users/me/preferences', authorization: 'Bearer disposable-contract-token' },
      { url: 'https://api.vcrcapps.com/notifications', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-sessions?scope=chats', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-memory', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-sessions/x/pending-permissions', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-approvals?status=pending', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-delegation/status?callerSessionId=x', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/opencode/mcp', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/opencode/skills', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-schedules', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/mobile-gateway/devices', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/opencode/commands', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agents/run-quality?windowDays=1', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-cookbook', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-research/projects', authorization: 'Bearer disposable-contract-token' },
      { url: 'http://127.0.0.1:4098/agent-designs', authorization: 'Bearer disposable-contract-token' },
    ]);
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
