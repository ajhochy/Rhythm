import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import path from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ENGINE, assertResponse, expectedRevision, localRows, responseFor } from './feature-test';
import { ensurePrimaryForPrivateActor } from './primary-read';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[P0] private missing primary cwd fails visibly without changing the canonical journal or ordinary chat';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page, sessions }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'cwd rename requires the private signed-in actor').toBeDefined();
  await sessions.open();
  const me = await sessions.api!.json<{ user: { id: number; email: string } }>('/auth/me');
  expect(me.user).toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email });
  // Create the disposable ordinary chat before selecting/creating the primary,
  // so session creation cannot inherit the primary project or its cwd.
  const ordinary = await sessions.create(' before missing primary cwd');
  const ordinaryBefore = await sessions.read(ordinary.id);
  const ordinaryRows = () => localRows(`SELECT id,name,owner_user_id,project_id,sdk_session_id,cwd
    FROM agent_sessions WHERE id=?`, ordinary.id);
  const ordinaryDurable = ordinaryRows();
  expect(ordinaryDurable).toHaveLength(1);
  expect(ordinaryDurable[0]).toMatchObject({ id: ordinary.id, name: ordinary.name,
    owner_user_id: manifest.ownerUserId });
  const root = await ensurePrimaryForPrivateActor(page, sessions.api!);

  const primaryRows = () => localRows(`SELECT id,project_id,owner_user_id,profile_id,sdk_session_id,cwd,
    parent_session_id,is_system,category,archived_at,coordinator_conversation_json
    FROM agent_sessions WHERE owner_user_id=? AND coordinator_conversation_json IS NOT NULL`, manifest.ownerUserId);
  const rows = primaryRows();
  expect(rows, 'exactly one private canonical journal is required').toHaveLength(1);
  const canonical = rows[0];
  const journal = JSON.parse(String(canonical.coordinator_conversation_json));
  expect(canonical).toMatchObject({ id: root.id, project_id: root.project_id,
    owner_user_id: manifest.ownerUserId, profile_id: 'coding-agent', sdk_session_id: null,
    parent_session_id: null, is_system: 0, category: 'chat', archived_at: null });
  expect(journal).toMatchObject({ schemaVersion: 4, primaryOwnerRoot: true,
    sessionId: root.id, projectId: root.project_id, ownerUserId: manifest.ownerUserId, goals: [] });
  const projects = localRows(`SELECT id,cwd,archived_at,coordinator_owner_user_id,coordinator_setup_provenance,
    coordinator_profile_id,coordinator_workspace_generation FROM projects WHERE id=?`, root.project_id);
  expect(projects).toHaveLength(1);
  const project = projects[0];
  expect(project).toMatchObject({ id: root.project_id, cwd: canonical.cwd, archived_at: null,
    coordinator_owner_user_id: manifest.ownerUserId,
    coordinator_setup_provenance: 'c2_fresh_owned_workspace_v1',
    coordinator_profile_id: canonical.profile_id,
    coordinator_workspace_generation: expect.any(Number) });
  expect(ordinaryDurable[0].project_id, 'ordinary chat must not share the primary project').not.toBe(root.project_id);
  expect(ordinaryDurable[0].cwd, 'ordinary chat must not use the primary cwd').not.toBe(canonical.cwd);
  const counts = () => ({
    projectSessions: localRows('SELECT count(*) n FROM agent_sessions WHERE project_id=?', root.project_id)[0].n,
    rootChildren: localRows('SELECT count(*) n FROM agent_sessions WHERE parent_session_id=?', root.id)[0].n,
    journalCommands: localRows('SELECT count(*) n FROM coordinator_conversation_commands WHERE root_session_id=?', root.id)[0].n,
    mirroredMessages: localRows('SELECT count(*) n FROM agent_session_messages WHERE session_id=?', root.id)[0].n,
    asyncDelegations: localRows('SELECT count(*) n FROM agent_async_delegations WHERE parent_session_id=?', root.id)[0].n,
    workstreams: localRows('SELECT count(*) n FROM agent_workstreams WHERE project_id=?', root.project_id)[0].n,
    pendingChildren: localRows('SELECT count(*) n FROM agent_pending_child_sessions')[0].n,
  });
  const inert = { projectSessions: 1, rootChildren: 0, journalCommands: 0, mirroredMessages: 0,
    asyncDelegations: 0, workstreams: 0, pendingChildren: 0 };
  expect(counts(), 'rename requires an inert private root and no pending child').toEqual(inert);

  const workspaces = realpathSync(path.join(manifest.fixtureRoot, 'live-artifacts', 'coordinator-workspaces'));
  const cwd = String(canonical.cwd);
  const relative = path.relative(workspaces, cwd);
  expect(path.isAbsolute(cwd) && path.resolve(cwd) === cwd && realpathSync(cwd) === cwd
    && relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), 'only the canonical fixture-owned project cwd may be renamed').toBe(true);
  const stat = lstatSync(cwd);
  expect(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
    && (stat.mode & 0o022) === 0, 'project cwd must be an owned, non-writable-by-others directory').toBe(true);
  expect(readdirSync(cwd), 'only an empty just-created project cwd may be renamed').toEqual([]);
  for (const protectedPath of [manifest.dbPath, manifest.syntheticActor!.tokenPath,
    path.join(manifest.fixtureRoot, 'opencode-config'), path.join(manifest.fixtureRoot, 'manifest.json')]) {
    const insideCwd = path.relative(cwd, protectedPath);
    expect(insideCwd === '' || (insideCwd !== '..' && !insideCwd.startsWith(`..${path.sep}`)
      && !path.isAbsolute(insideCwd)), 'DB, config, token and manifest must be outside cwd').toBe(false);
  }
  const engine = async (route: string) => {
    const response = await fetch(`${ENGINE}${route}?directory=${encodeURIComponent(cwd)}`, { signal: AbortSignal.timeout(20_000) });
    expect(response.status).toBe(200);
    return response.json() as Promise<unknown>;
  };
  const expectIdle = async () => {
    // The fork's Session.list can ignore the directory filter under
    // experimental workspaces; /session/status is a global status map.
    const sessions = await engine('/session');
    expect(Array.isArray(sessions), 'real engine session catalog shape').toBe(true);
    for (const session of sessions as Array<{ id?: unknown; directory?: unknown }>) {
      expect(typeof session.id).toBe('string');
      expect(typeof session.directory).toBe('string');
    }
    const inRoot = (sessions as Array<{ id: string; directory: string }>).filter(session => session.directory === cwd);
    expect(inRoot, 'no SDK sessions may use the private root cwd').toEqual([]);
    const status = await engine('/session/status');
    expect(status !== null && typeof status === 'object' && !Array.isArray(status),
      'real engine status map shape').toBe(true);
    expect(inRoot.filter(session => Object.hasOwn(status as object, session.id)),
      'no engine work may use the private root cwd').toEqual([]);
  };
  await expectIdle();

  const apiState = async () => {
    const output: Record<string, unknown> = {};
    for (const [key, route, input, kind] of [
      ['resolve', '/coordinator-conversations/resolve', {}, 'resolved'],
      ['open', '/coordinator-conversations/open', { sessionId: root.id, projectId: root.project_id }, 'replay'],
      ['history', '/coordinator-conversations/history', { sessionId: root.id, projectId: root.project_id, limit: 50 }, 'history'],
    ] as const) {
      const response = await sessions.api!.fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      expect(response.status, `normal API ${key}`).toBe(200);
      const body = await response.json() as { kind: string; sessionId?: string; projectId?: string;
        conversation?: { sessionId: string; projectId: string }; messages?: unknown[] };
      expect(body).toMatchObject({ kind, ...(key === 'history' ? { messages: [] } : {}) });
      expect(body.sessionId ?? body.conversation?.sessionId).toBe(root.id);
      expect(body.projectId ?? body.conversation?.projectId).toBe(root.project_id);
      output[key] = { status: response.status, kind: body.kind, sessionId: root.id, projectId: root.project_id,
        messageCount: body.messages?.length ?? null };
    }
    return output;
  };
  const before = await apiState();
  expect(primaryRows()).toEqual(rows);
  expect(counts()).toEqual(inert);
  expect(await sessions.read(ordinary.id)).toMatchObject({ id: ordinary.id, name: ordinaryBefore.name });
  expect(ordinaryRows()).toEqual(ordinaryDurable);

  const backup = path.join(workspaces, `.smoke-missing-cwd-${randomUUID()}`);
  expect(lstatSync(backup, { throwIfNoEntry: false }), 'nonce backup path must be absent').toBeUndefined();
  let renamed = false;
  try {
    // Recheck authority directly beside the only filesystem mutation.
    expect(primaryRows()).toEqual(rows);
    expect(counts()).toEqual(inert);
    expect(readdirSync(cwd)).toEqual([]);
    await expectIdle();
    renameSync(cwd, backup);
    renamed = true;
    const moved = lstatSync(backup);
    expect(moved.dev).toBe(stat.dev);
    expect(moved.ino).toBe(stat.ino);
    expect(lstatSync(cwd, { throwIfNoEntry: false })).toBeUndefined();

    const missing = await apiState();
    expect(missing, 'missing cwd must not rewrite the canonical API journal').toEqual(before);
    const resolved = responseFor(page, 'POST', '/coordinator-conversations/resolve');
    await page.getByTestId('rhythm-primary-entry').click();
    const response = await resolved;
    await assertResponse(response, 'POST', '/coordinator-conversations/resolve', 200);
    expect(new URL(response.url()).origin).toBe(API);
    expect(await response.json()).toMatchObject({ kind: 'resolved', sessionId: root.id, projectId: root.project_id });
    await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm could not be opened. Your ordinary chats are unchanged.');
    await expect(page.getByTestId('rhythm-setup-dialog')).toBeHidden();
    await expect(page.getByTestId('composer-input')).toBeDisabled();
    await expect(page.getByTestId('composer-send')).toBeDisabled();
    // The native failure reproduced after an already-settled unavailable view,
    // rather than restoring the directory in the same reconciliation tick.
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('composer-input')).toBeDisabled();
    expect(primaryRows()).toEqual(rows);
    expect(counts()).toEqual(inert);
    expect(await sessions.read(ordinary.id)).toMatchObject({ id: ordinary.id, name: ordinaryBefore.name });
    expect(ordinaryRows()).toEqual(ordinaryDurable);
    expect(lstatSync(cwd, { throwIfNoEntry: false })).toBeUndefined();
  } finally {
    if (renamed) {
      const moved = lstatSync(backup, { throwIfNoEntry: false });
      expect(moved && moved.isDirectory() && moved.dev === stat.dev && moved.ino === stat.ino,
        'refuse restore if the nonce backup inode changed').toBe(true);
      expect(lstatSync(cwd, { throwIfNoEntry: false }), 'refuse overwrite if the app recreated cwd').toBeUndefined();
      renameSync(backup, cwd);
      const restored = lstatSync(cwd);
      expect(restored.dev).toBe(stat.dev);
      expect(restored.ino).toBe(stat.ino);
      expect(lstatSync(backup, { throwIfNoEntry: false })).toBeUndefined();
    }
  }
  expect(await apiState()).toEqual(before);
  expect(primaryRows()).toEqual(rows);
  expect(counts()).toEqual(inert);
  expect(ordinaryRows()).toEqual(ordinaryDurable);
  const recoveredStatus = responseFor(page, 'POST', '/coordinator-conversations/status');
  await page.getByTestId('rhythm-primary-entry').click();
  const recovered = await recoveredStatus;
  await assertResponse(recovered, 'POST', '/coordinator-conversations/status', 200);
  expect(await recovered.json()).toMatchObject({ kind: 'status',
    conversation: { primaryOwnerRoot: true, sessionId: root.id, projectId: root.project_id } });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm is ready.');
  await expect(page.locator('.conversation-pane .status-label')).toHaveText('Ready');
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await expect(page.getByTestId('composer-send')).toBeEnabled();
  expect(primaryRows()).toEqual(rows);
  expect(counts()).toEqual(inert);
  expect(ordinaryRows()).toEqual(ordinaryDurable);
});
