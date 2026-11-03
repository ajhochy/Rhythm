import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, responseFor, assertResponse, localRows, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[P0] primary first use chooses a profile before creating one private canonical root';

if (!manifestPath) {
  // A normal saved profile must never launch just to discover that its permanent
  // primary journal cannot be used as a disposable first-use fixture.
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else test(title, async ({ page, sessions }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'first use requires the private signed-in actor').toBeDefined();
  await sessions.open();
  const me = await sessions.api!.json<{ user: { id: number } }>('/auth/me');
  expect(me.user.id).toBe(manifest.ownerUserId);
  const ordinary = await sessions.create(' before Rhythm first use');
  const primaryRoots = () => localRows(`SELECT id, project_id, owner_user_id, profile_id, sdk_session_id,
    coordinator_conversation_json FROM agent_sessions WHERE owner_user_id=? AND parent_session_id IS NULL
    AND is_system=0 AND category='chat'
    AND json_extract(coordinator_conversation_json,'$.primaryOwnerRoot')=1`, manifest.ownerUserId);
  const setupProjects = () => localRows('SELECT id FROM projects WHERE coordinator_owner_user_id=?', manifest.ownerUserId);
  expect(primaryRoots(), 'UNVERIFIED: this fixture has already allocated a primary root').toHaveLength(0);
  const projectsBefore = setupProjects();

  const resolve = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  const choice = responseFor(page, 'POST', '/coordinator-conversations/setup');
  await page.getByTestId('rhythm-primary-entry').click();
  const resolveResponse = await resolve;
  await assertResponse(resolveResponse, 'POST', '/coordinator-conversations/resolve', 503);
  expect(await resolveResponse.json()).toEqual({ kind: 'setup_unavailable' });
  const choiceResponse = await choice;
  await assertResponse(choiceResponse, 'POST', '/coordinator-conversations/setup', 200);
  expect(await choiceResponse.json()).toMatchObject({ kind: 'setup_profile_choice_required',
    profileChoices: expect.arrayContaining([{ id: 'coding-agent', label: expect.any(String) }]) });
  await expect(page.getByTestId('rhythm-setup-dialog')).toBeVisible();
  await expect(page.getByTestId('rhythm-setup-profile-coding-agent')).toBeVisible();
  await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Choose a Rhythm profile to finish setup.');
  expect(primaryRoots(), 'profile-choice discovery must not allocate a root').toHaveLength(0);
  expect(setupProjects(), 'profile-choice discovery must not allocate a project').toEqual(projectsBefore);

  await page.getByTestId('rhythm-setup-keep-ordinary').click();
  await expect(page.getByTestId('rhythm-setup-dialog')).toBeHidden();
  await expect(page.getByTestId(`session-${ordinary.id}`)).toHaveAttribute('aria-current', 'true');
  expect(primaryRoots(), 'dismissing setup must not allocate a root').toHaveLength(0);
  await page.getByTestId('rhythm-primary-entry').click();
  await expect(page.getByTestId('rhythm-setup-dialog')).toBeVisible();
  await expect(page.getByTestId('rhythm-setup-profile-coding-agent')).toBeVisible();

  const created = responseFor(page, 'POST', '/coordinator-conversations/setup');
  const opened = responseFor(page, 'POST', '/coordinator-conversations/open');
  const history = responseFor(page, 'POST', '/coordinator-conversations/history');
  await page.getByTestId('rhythm-setup-profile-coding-agent').click();
  const createdResponse = await created;
  await assertResponse(createdResponse, 'POST', '/coordinator-conversations/setup', 201);
  const body = await createdResponse.json() as { kind: string; sessionId: string; projectId: string;
    profileId: string; conversation: { schemaVersion: number; sessionId: string; projectId: string;
      ownerUserId: number; primaryOwnerRoot: boolean; goals: unknown[] } };
  expect(body).toMatchObject({ kind: 'setup_created', sessionId: expect.any(String),
    projectId: expect.any(String), profileId: 'coding-agent', conversation: {
      schemaVersion: 4, sessionId: body.sessionId, projectId: body.projectId,
      ownerUserId: manifest.ownerUserId, primaryOwnerRoot: true, goals: [],
    } });
  const openResponse = await opened;
  await assertResponse(openResponse, 'POST', '/coordinator-conversations/open', 200);
  expect(await openResponse.json()).toMatchObject({ kind: 'replay', conversation: {
    sessionId: body.sessionId, projectId: body.projectId, ownerUserId: manifest.ownerUserId, primaryOwnerRoot: true,
  } });
  const historyResponse = await history;
  await assertResponse(historyResponse, 'POST', '/coordinator-conversations/history', 200);
  expect(await historyResponse.json()).toMatchObject({ kind: 'history', conversation: {
    sessionId: body.sessionId, projectId: body.projectId, ownerUserId: manifest.ownerUserId, primaryOwnerRoot: true,
  }, messages: [], hasMore: false });
  await expect(page.getByTestId('rhythm-setup-dialog')).toBeHidden();
  await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm is ready.');
  await expect(page.getByTestId(`session-${body.sessionId}`)).toHaveAttribute('aria-current', 'true');

  const roots = primaryRoots();
  expect(roots, 'setup must leave exactly one canonical root for later packaged cases').toHaveLength(1);
  expect(roots[0]).toMatchObject({ id: body.sessionId, project_id: body.projectId,
    owner_user_id: manifest.ownerUserId, profile_id: 'coding-agent', sdk_session_id: null });
  expect(JSON.parse(String(roots[0].coordinator_conversation_json))).toMatchObject({
    schemaVersion: 4, sessionId: body.sessionId, ownerUserId: manifest.ownerUserId,
    projectId: body.projectId, primaryOwnerRoot: true, goals: [],
  });
  const projects = localRows('SELECT id,cwd,coordinator_owner_user_id FROM projects WHERE id=?', body.projectId);
  expect(projects).toMatchObject([{ id: body.projectId, coordinator_owner_user_id: manifest.ownerUserId,
    cwd: expect.any(String) }]);
  const liveArtifacts = realpathSync(path.join(manifest.fixtureRoot, 'live-artifacts', 'coordinator-workspaces'));
  const projectCwd = realpathSync(String(projects[0].cwd));
  expect(statSync(projectCwd).isDirectory()).toBe(true);
  expect(path.relative(liveArtifacts, projectCwd)).not.toMatch(/^\.\.(?:\/|$)/);
  expect(path.isAbsolute(path.relative(liveArtifacts, projectCwd))).toBe(false);
  // This private Coordinator root is intentionally retained for the following
  // read/reopen cases. sessions' nonce-owned ordinary chat is cleaned up.
});
