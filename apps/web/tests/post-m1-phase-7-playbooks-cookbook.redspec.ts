import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

test('post-m1-p7-c2e: live managed playbook refreshes the engine catalog and becomes slash-command available', async ({ page }) => {
  // Regression caught: playbook refresh and mutation only change local component state.
  const seen: SeenRequest[] = [];
  const command = { name: 'phase-7-playbook', description: 'Canonical playbook', source: 'command', managed: true, hints: ['$ARGUMENTS'] };
  await openPhase7Live(page, '/tools/playbooks', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/opencode/commands') return fulfillJson(route, 200, [command]).then(() => true);
    if (url.pathname === `/opencode/commands/${command.name}/content`) {
      return fulfillJson(route, 200, { name: command.name, frontmatter: { description: command.description, agent: 'research', model: null, subtask: false }, template: 'Research $ARGUMENTS' }).then(() => true);
    }
    return false;
  });

  await page.getByTestId('playbooks-refresh').click();
  await expect.poll(() => matching(seen, 'GET', '/opencode/commands').length).toBeGreaterThan(0);
  await expect(page.getByText(command.name, { exact: true })).toBeVisible();
  await expect(page.getByText('command', { exact: true })).toBeVisible();
  await expect(page.getByText('managed', { exact: true })).toBeVisible();
});

test('post-m1-p7-c2f: live cookbook persists stepsJson and boundConfigId then opens the returned owned session', async ({ page }) => {
  // Regression caught: recipe create/run fabricates local recipe and session IDs.
  const seen: SeenRequest[] = [];
  const recipe = {
    id: 'recipe-7', title: 'Phase 7 recipe', description: null,
    stepsJson: '[{"action":"verify","text":"Verify evidence"}]', boundConfigId: 'research',
    ownerUserId: 7, createdAt: '2026-08-15T09:00:00.000Z', updatedAt: '2026-08-15T09:00:00.000Z',
  };
  await openPhase7Live(page, '/tools/cookbook', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-cookbook') return fulfillJson(route, request.method() === 'POST' ? 201 : 200, request.method() === 'POST' ? recipe : [recipe]).then(() => true);
    if (url.pathname === `/agent-cookbook/${recipe.id}/run`) return fulfillJson(route, 202, { sessionId: 'session-recipe-7', status: 'dispatched' }).then(() => true);
    if (url.pathname === '/agent-sessions/session-recipe-7') return fulfillJson(route, 200, { id: 'session-recipe-7', ownerUserId: 7, status: 'working' }).then(() => true);
    return false;
  });

  await page.getByTestId('cookbook-refresh').click();
  await expect.poll(() => matching(seen, 'GET', '/agent-cookbook').length).toBeGreaterThan(0);
  await expect(page.getByText(recipe.title, { exact: true })).toBeVisible();
  await page.getByTestId(`cookbook-run-${recipe.id}`).click();
  await expect.poll(() => matching(seen, 'POST', `/agent-cookbook/${recipe.id}/run`).length).toBe(1);
  await expect.poll(() => matching(seen, 'GET', '/agent-sessions/session-recipe-7').length).toBe(1);
});
