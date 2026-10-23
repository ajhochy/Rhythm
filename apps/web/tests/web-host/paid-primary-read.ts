import type { Page } from '@playwright/test';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, ObservedApi, responseFor, assertResponse, localRows, paidFixture, validatePaidOwner, ownedWorkspace } from './paid-parity-fixture';

/** Prepare a first-use root only for the exact disposable signed-in actor. */
export async function ensurePrimaryForPrivateActor(page: Page, api: ObservedApi) {
  const { manifest } = paidFixture();
  expect(await validatePaidOwner(api)).toBe(manifest.ownerUserId);
  const roots = localRows(`SELECT id FROM agent_sessions WHERE owner_user_id=? AND parent_session_id IS NULL
    AND is_system=0 AND category='chat'
    AND json_extract(coordinator_conversation_json,'$.primaryOwnerRoot')=1`, manifest.ownerUserId);
  expect(roots.length, 'refuse ambiguous private primary roots').toBeLessThanOrEqual(1);

  let createdId: string | null = null;
  if (roots.length === 0) {
    const resolve = responseFor(page, 'POST', '/coordinator-conversations/resolve');
    const choice = responseFor(page, 'POST', '/coordinator-conversations/setup');
    await page.getByTestId('rhythm-primary-entry').click();
    const resolveResponse = await resolve;
    await assertResponse(resolveResponse, 'POST', '/coordinator-conversations/resolve', 503);
    expect(await resolveResponse.json()).toEqual({ kind: 'setup_unavailable' });
    const choiceResponse = await choice;
    await assertResponse(choiceResponse, 'POST', '/coordinator-conversations/setup', 200);
    expect(await choiceResponse.json()).toMatchObject({ kind: 'setup_profile_choice_required',
      profileChoices: expect.arrayContaining([expect.objectContaining({ id: 'coding-agent' })]) });
    await expect(page.getByTestId('rhythm-setup-profile-coding-agent')).toBeVisible();
    const setup = responseFor(page, 'POST', '/coordinator-conversations/setup');
    await page.getByTestId('rhythm-setup-profile-coding-agent').click();
    const setupResponse = await setup;
    await assertResponse(setupResponse, 'POST', '/coordinator-conversations/setup', 201);
    const body = await setupResponse.json() as { sessionId: string; projectId: string;
      conversation: { primaryOwnerRoot: boolean; ownerUserId: number } };
    expect(body.conversation).toMatchObject({ primaryOwnerRoot: true, ownerUserId: manifest.ownerUserId });
    createdId = body.sessionId;
    await expect(page.getByTestId('rhythm-primary-status')).toHaveText('Rhythm is ready.');
  }

  const root = await existingPrimary(page);
  if (createdId) expect(root.id, 'first-use root must match server setup response').toBe(createdId);
  const project = localRows('SELECT id,cwd,coordinator_owner_user_id FROM projects WHERE id=?', root.project_id);
  expect(project).toHaveLength(1);
  expect(project[0].coordinator_owner_user_id).toBe(manifest.ownerUserId);
  const artifactRoot = realpathSync(path.join(manifest.fixtureRoot, 'live-artifacts', 'coordinator-workspaces'));
  const projectCwd = realpathSync(String(project[0].cwd));
  const relative = path.relative(artifactRoot, projectCwd);
  expect(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'private primary must remain under fixture-owned live artifacts').toBe(true);
  ownedWorkspace(projectCwd);
  return root;
}

/** Resolve is not a discovery-only endpoint: prequalify the actor's existing root without writing. */
export async function existingPrimary(page: Page) {
  const ownerId = await validatePaidOwner();
  const roots = localRows(`SELECT id, name, project_id, owner_user_id, coordinator_conversation_json
    FROM agent_sessions WHERE owner_user_id=? AND parent_session_id IS NULL
    AND is_system=0 AND category='chat'
    AND json_extract(coordinator_conversation_json,'$.primaryOwnerRoot')=1`, ownerId);
  expect(roots, 'UNVERIFIED: a unique existing owned primary root is required; first-use creation needs a disposable account/database').toHaveLength(1);
  const root = roots[0];
  expect(typeof root.project_id).toBe('string');
  const projects = localRows(`SELECT p.cwd FROM projects p JOIN agent_sessions s ON s.project_id=p.id
    WHERE s.id=? AND s.archived_at IS NULL AND p.archived_at IS NULL`, root.id);
  expect(projects, 'UNVERIFIED: existing primary root must belong to an active project').toHaveLength(1);
  let usableDirectory = false;
  try { usableDirectory = statSync(ownedWorkspace(String(projects[0].cwd))).isDirectory(); } catch { /* Fail closed before resolve. */ }
  expect(usableDirectory, 'UNVERIFIED: existing primary project directory is unavailable; disposable setup is required').toBe(true);
  return root;
}

export async function openExistingPrimary(page: Page) {
  const root = await existingPrimary(page);
  // A stale setup cannot silently allocate a non-smoke project/root during this read-only test.
  await page.route('**/coordinator-conversations/setup', route => route.abort('blockedbyclient'));
  const resolved = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  await page.getByTestId('rhythm-primary-entry').click();
  const response = await resolved; await assertResponse(response, 'POST', '/coordinator-conversations/resolve', 200);
  expect(await response.json()).toMatchObject({ kind: 'resolved', created: false, sessionId: root.id, projectId: root.project_id, conversation: { primaryOwnerRoot: true } });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  return { root, api: ObservedApi.from(response) };
}

export async function openRuns(page: Page) {
  const details = page.getByTestId('session-details');
  if (await details.getAttribute('aria-expanded') === 'false') await details.click();
  const collapsed = page.getByTestId('inspector-collapsed-runs');
  if (await collapsed.isVisible()) await collapsed.click();
  else await page.getByTestId('inspector-runs').click();
  await expect(page.getByTestId('coordinator-conversation-card')).toContainText('Coding runs');
}
