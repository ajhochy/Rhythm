import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, responseFor, assertResponse, ObservedApi } from './parity-fixture';
import { OwnedWebCoordinator, openRuns } from './owned-web-coordinator-fixture';

test('[web #57] primary permanent entry reopens the server-designated root and canonical history', async ({ page, sessions, parity }) => {
  await sessions.open();
  const primary = new OwnedWebCoordinator(page, parity);
  await primary.create();
  const history = responseFor(page, 'POST', '/coordinator-conversations/history');
  const root = await primary.reopen();
  const response = await history;
  await assertResponse(response, 'POST', '/coordinator-conversations/history', 200);
  expect(await response.json()).toMatchObject({ kind: 'history',
    conversation: { sessionId: root.id, ownerUserId: 1, primaryOwnerRoot: true }, messages: expect.any(Array) });
  await openRuns(page);
  const reopened = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  await page.getByTestId('rhythm-primary-entry').click();
  const replay = await reopened;
  await assertResponse(replay, 'POST', '/coordinator-conversations/resolve', 200);
  expect(await replay.json()).toMatchObject({ created: false, sessionId: root.id });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
});

test('[web #58] failed primary resolve preserves the ordinary session and visibly retries', async ({ page, sessions, parity }) => {
  await sessions.open();
  const primary = new OwnedWebCoordinator(page, parity);
  const root = await primary.create();
  const ordinary = await sessions.create(' primary fallback');
  const fail = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { error: 'temporary service failure' } });
  await page.route('**/coordinator-conversations/resolve', fail);
  try {
    const failed = responseFor(page, 'POST', '/coordinator-conversations/resolve');
    await page.getByTestId('rhythm-primary-entry').click();
    await assertResponse(await failed, 'POST', '/coordinator-conversations/resolve', 503);
    await expect(page.getByText('Rhythm could not be opened. Your ordinary chats are unchanged.', { exact: true })).toBeVisible();
    await expect(page.getByTestId(`session-${ordinary.id}`)).toHaveAttribute('aria-current', 'true');
    expect(await sessions.read(ordinary.id)).toMatchObject({ id: ordinary.id, name: ordinary.name, ownerUserId: 1 });
  } finally { await page.unroute('**/coordinator-conversations/resolve', fail); }
  expect((await primary.reopen()).id).toBe(root.id);
});

test('[web #59] rapid primary entry and reload keep one canonical root', async ({ page, sessions, parity }) => {
  await sessions.open();
  const primary = new OwnedWebCoordinator(page, parity);
  const root = await primary.create();
  const rootsBefore = primary.roots();
  await page.route('**/coordinator-conversations/setup', route => route.abort('blockedbyclient'));
  const resolved = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  await page.getByTestId('rhythm-primary-entry').dblclick();
  const response = await resolved;
  await assertResponse(response, 'POST', '/coordinator-conversations/resolve', 200);
  expect(await response.json()).toMatchObject({ created: false, sessionId: root.id });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
  await page.reload();
  expect((await primary.reopen()).id).toBe(root.id);
  expect(primary.existing().id).toBe(root.id);
  expect(primary.roots()).toEqual(rootsBefore);
});

test('[web #60] primary first use chooses a profile before creating one private canonical root', async ({ page, sessions, parity }) => {
  await sessions.open();
  const primary = new OwnedWebCoordinator(page, parity);
  const ordinary = await sessions.create(' before Rhythm first use');
  const setupBodies: { commandKey: string; profileId?: string }[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url() === `${parity.origin}/coordinator-conversations/setup`) {
      setupBodies.push(request.postDataJSON());
    }
  });
  await primary.choose();
  expect(setupBodies).toEqual([{ commandKey: expect.any(String) }]);
  await page.getByTestId('rhythm-setup-keep-ordinary').click();
  await expect(page.getByTestId('rhythm-setup-dialog')).toBeHidden();
  await expect(page.getByTestId(`session-${ordinary.id}`)).toHaveAttribute('aria-current', 'true');
  expect(primary.roots()).toEqual([]);
  expect(primary.projects()).toEqual(primary.projectsBefore);
  // The deferred chooser retains its server-provided choices and setup key.
  // Reopening it is local; only selecting a profile sends the second setup.
  await page.getByTestId('rhythm-primary-entry').click();
  await expect(page.getByTestId('rhythm-setup-dialog')).toBeVisible();
  await expect(page.getByTestId('rhythm-setup-profile-local-lean')).toBeVisible();
  await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Choose a Rhythm profile to finish setup.');
  await expect(page.getByTestId(`session-${ordinary.id}`)).toHaveAttribute('aria-current', 'true');
  expect(setupBodies).toEqual([{ commandKey: expect.any(String) }]);
  expect(primary.roots()).toEqual([]);
  expect(primary.projects()).toEqual(primary.projectsBefore);
  const root = await primary.createFromChoice();
  expect(setupBodies).toEqual([
    { commandKey: setupBodies[0].commandKey },
    { commandKey: setupBodies[0].commandKey, profileId: 'local-lean' },
  ]);
  expect(primary.roots()).toHaveLength(1);
  expect(primary.existing()).toEqual(root);
  expect(primary.projects()).toHaveLength(primary.projectsBefore.length + 1);
  await primary.expectIdle(root.cwd);
});

test('[web #61] missing primary cwd fails visibly without changing the canonical journal or ordinary chat', async ({ page, sessions, parity }) => {
  await sessions.open();
  const primary = new OwnedWebCoordinator(page, parity);
  const ordinary = await sessions.create(' before missing primary cwd');
  const ordinaryBefore = await sessions.read(ordinary.id);
  const ordinaryRows = () => parity.rows('SELECT id,name,owner_user_id,project_id,sdk_session_id,cwd FROM agent_sessions WHERE id=?', ordinary.id);
  const ordinaryDurable = ordinaryRows();
  expect(ordinaryDurable).toHaveLength(1);
  expect(ordinaryDurable[0]).toMatchObject({ id: ordinary.id, name: ordinary.name, owner_user_id: 1 });
  const root = await primary.create();
  const rows = primary.roots();
  const projectRows = () => parity.rows(`SELECT id,cwd,archived_at,coordinator_owner_user_id,coordinator_setup_provenance,
    coordinator_profile_id,coordinator_workspace_generation FROM projects WHERE id=?`, root.project_id);
  const project = projectRows();
  expect(project).toMatchObject([{ id: root.project_id, cwd: root.cwd, archived_at: null,
    coordinator_owner_user_id: 1, coordinator_setup_provenance: 'c2_fresh_owned_workspace_v1',
    coordinator_profile_id: 'local-lean', coordinator_workspace_generation: expect.any(Number) }]);
  expect(ordinaryDurable[0].project_id).not.toBe(root.project_id);
  expect(ordinaryDurable[0].cwd).not.toBe(root.cwd);
  const inert = { projectSessions: 1, rootChildren: 0, journalCommands: 0, mirroredMessages: 0,
    asyncDelegations: 0, workstreams: 0, pendingChildren: 0 };
  expect(primary.counts(root)).toEqual(inert);
  const { parent, stat } = primary.workspace(root.cwd);
  expect(fs.readdirSync(root.cwd)).toEqual([]);
  for (const protectedPath of [parity.dbPath, path.join(parity.sandbox, 'home/.config/opencode'), `${parity.sandbox}-fixtures`]) {
    const relative = path.relative(root.cwd, protectedPath);
    expect(relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))).toBe(false);
  }
  await primary.expectIdle(root.cwd);
  const apiState = async () => {
    const result: Record<string, unknown> = {};
    for (const [route, input, kind] of [
      ['resolve', {}, 'resolved'], ['open', { sessionId: root.id, projectId: root.project_id }, 'replay'],
      ['history', { sessionId: root.id, projectId: root.project_id, limit: 50 }, 'history'],
    ] as const) {
      const response = await parity.api.request('POST', `/coordinator-conversations/${route}`, input);
      expect(response.status, `normal API ${route}`).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ kind, ...(route === 'history' ? { messages: [] } : {}) });
      expect(body.sessionId ?? body.conversation?.sessionId).toBe(root.id);
      expect(body.projectId ?? body.conversation?.projectId).toBe(root.project_id);
      result[route] = { status: response.status, kind: body.kind, sessionId: root.id,
        projectId: root.project_id, messageCount: body.messages?.length ?? null };
    }
    return result;
  };
  const before = await apiState();
  const unchanged = async () => {
    expect(primary.roots()).toEqual(rows);
    expect(projectRows()).toEqual(project);
    expect(primary.counts(root)).toEqual(inert);
    expect(await sessions.read(ordinary.id)).toMatchObject({ id: ordinary.id, name: ordinaryBefore.name });
    expect(ordinaryRows()).toEqual(ordinaryDurable);
  };
  await unchanged();
  const backup = path.join(parent, `.smoke-missing-cwd-${randomUUID()}`);
  expect(fs.lstatSync(backup, { throwIfNoEntry: false })).toBeUndefined();
  let renamed = false;
  try {
    await unchanged();
    expect(fs.readdirSync(root.cwd)).toEqual([]);
    await primary.expectIdle(root.cwd);
    fs.renameSync(root.cwd, backup);
    renamed = true;
    expect(fs.lstatSync(backup)).toMatchObject({ dev: stat.dev, ino: stat.ino });
    expect(fs.lstatSync(root.cwd, { throwIfNoEntry: false })).toBeUndefined();
    expect(await apiState()).toEqual(before);
    const resolved = responseFor(page, 'POST', '/coordinator-conversations/resolve');
    await page.getByTestId('rhythm-primary-entry').click();
    const response = await resolved;
    await assertResponse(response, 'POST', '/coordinator-conversations/resolve', 200);
    expect(await response.json()).toMatchObject({ kind: 'resolved', sessionId: root.id, projectId: root.project_id });
    await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm could not be opened. Your ordinary chats are unchanged.');
    await expect(page.getByTestId('rhythm-setup-dialog')).toBeHidden();
    await expect(page.getByTestId('composer-input')).toBeDisabled();
    await expect(page.getByTestId('composer-send')).toBeDisabled();
    // Preserve the source regression's already-settled unavailable view.
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('composer-input')).toBeDisabled();
    await unchanged();
    expect(fs.lstatSync(root.cwd, { throwIfNoEntry: false })).toBeUndefined();
  } finally {
    if (renamed) {
      const moved = fs.lstatSync(backup, { throwIfNoEntry: false });
      expect(moved?.isDirectory() && moved.dev === stat.dev && moved.ino === stat.ino).toBe(true);
      expect(fs.lstatSync(root.cwd, { throwIfNoEntry: false }), 'Refuse overwrite if app recreated cwd').toBeUndefined();
      fs.renameSync(backup, root.cwd);
      expect(fs.lstatSync(root.cwd)).toMatchObject({ dev: stat.dev, ino: stat.ino });
      expect(fs.existsSync(backup)).toBe(false);
    }
  }
  expect(await apiState()).toEqual(before);
  await unchanged();
  const recovered = responseFor(page, 'POST', '/coordinator-conversations/status');
  await page.getByTestId('rhythm-primary-entry').click();
  const response = await recovered;
  await assertResponse(response, 'POST', '/coordinator-conversations/status', 200);
  expect(await response.json()).toMatchObject({ kind: 'status', conversation: {
    primaryOwnerRoot: true, sessionId: root.id, projectId: root.project_id } });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm is ready.');
  await expect(page.locator('.conversation-pane .status-label')).toHaveText('Ready');
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await expect(page.getByTestId('composer-send')).toBeEnabled();
  await unchanged();
  await primary.expectIdle(root.cwd);
});

test('[web #62] shared agent canonical revision and OpenCode readiness match the real catalog', async ({ page, parity }) => {
  await page.goto('/#/tools/agent-tools');
  const pending = responseFor(page, 'GET', '/shared-agents/v1/catalog');
  await page.goto('/#/tools/shared-agents');
  const response = await pending;
  await assertResponse(response, 'GET', '/shared-agents/v1/catalog', 200);
  const catalog = await response.json();
  expect(Array.isArray(catalog.agents)).toBe(true);
  expect(catalog.agents.length).toBeGreaterThan(0);
  const row = catalog.agents[0];
  await page.getByTestId(`shared-agent-${row.id}`).click();
  const screen = page.getByTestId('shared-agents-screen');
  // Matrix §8 explicitly excludes native Hermes readiness during this phase.
  expect(typeof row.runtimes.opencode.readiness).toBe('string');
  await expect(screen.getByTestId('shared-agent-readiness-opencode')).toHaveText(
    new RegExp(row.runtimes.opencode.readiness.replace(/-/g, ' '), 'i'));
  const api = ObservedApi.from(response, parity);
  const readback = await api.json<{ agents: { id: string; revision: number; runtimes: unknown }[] }>('/shared-agents/v1/catalog');
  expect(readback.agents.find(agent => agent.id === row.id)).toMatchObject({ revision: row.revision, runtimes: row.runtimes });
  expect(parity.rows('SELECT revision FROM agent_configs WHERE id=?', row.id)).toEqual([{ revision: row.revision }]);
});
