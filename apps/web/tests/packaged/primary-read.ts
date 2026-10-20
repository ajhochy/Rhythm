import type { Page } from '@playwright/test';
import { realpathSync, statSync } from 'node:fs';
import { expect, ObservedApi, responseFor, assertResponse, localRows } from './feature-test';

/** Resolve is not a discovery-only endpoint: prequalify the actor's existing root without writing. */
export async function existingPrimary(page: Page) {
  // This is the same read-only IPC used by main.tsx to restore the signed-in desktop.
  // Return only the actor ID; its session token never leaves the renderer or enters test artifacts.
  const ownerId = await page.evaluate(async () => {
    const shell = (window as unknown as { rhythmShell: { auth: { currentSession(): Promise<{ user: { id: number } } | null> } } }).rhythmShell;
    return (await shell.auth.currentSession())?.user.id ?? null;
  });
  expect(ownerId, 'UNVERIFIED: no authenticated desktop actor').toEqual(expect.any(Number));
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
  try { usableDirectory = statSync(realpathSync(String(projects[0].cwd))).isDirectory(); } catch { /* Fail closed before resolve. */ }
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
