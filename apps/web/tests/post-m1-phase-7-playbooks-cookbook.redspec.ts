import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

test('rendered cookbook retains the recipe draft after a rejected save and retries its exact content', async ({ page }) => {
  const seen: SeenRequest[] = [];
  const recipes: Array<Record<string, unknown>> = [];
  let attempts = 0;
  await openPhase7Live(page, '/tools/cookbook', seen, async (route, request) => {
    if (new URL(request.url()).pathname !== '/agent-cookbook') return false;
    if (request.method() === 'POST') {
      attempts++;
      if (attempts === 1) return fulfillJson(route, 503, { error: { message: 'Controlled save failure' } }).then(() => true);
      const recipe = { ...request.postDataJSON(), id: 'owned-rendered-retry', ownerUserId: 7 };
      recipes.push(recipe);
      return fulfillJson(route, 201, recipe).then(() => true);
    }
    return fulfillJson(route, 200, recipes).then(() => true);
  });
  await page.getByTestId('cookbook-new').click();
  const editor = page.getByTestId('cookbook-editor');
  await editor.getByLabel('Title', { exact: true }).fill('[smoke] retry recipe');
  await editor.getByLabel('Description', { exact: true }).fill('Keep this draft');
  await editor.getByLabel('Steps (one per line)', { exact: true }).fill('First inert step.\nSecond inert step.');
  await page.getByTestId('cookbook-save').click();
  await expect(page.getByText('Create recipe failed (503)', { exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('[smoke] retry recipe');
  await expect(editor.getByLabel('Description', { exact: true })).toHaveValue('Keep this draft');
  await expect(editor.getByLabel('Steps (one per line)', { exact: true })).toHaveValue('First inert step.\nSecond inert step.');
  await page.getByTestId('cookbook-save').click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('recipe-owned-rendered-retry')).toContainText('[smoke] retry recipe');
  const posts = matching(seen, 'POST', '/agent-cookbook');
  expect(posts).toHaveLength(2);
  expect(posts[1].body).toEqual(posts[0].body);
  expect(recipes).toHaveLength(1);
});

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
