import { expect, test } from '@playwright/test';
import { chooseDemo, openFixture } from './helpers';

test('completes the shipping-shaped Agents operator flow', async ({ page }) => {
  await openFixture(page);

  await page.getByTestId('new-session-advanced').click();
  await page.getByTestId('advanced-name').fill('Operator verification pass');
  await page.getByTestId('advanced-branch').selectOption('__new__');
  await page.getByTestId('advanced-new-branch').fill('agents/operator-pass');
  await page.getByTestId('advanced-create').click();
  await expect(page.getByRole('heading', { name: 'Operator verification pass' })).toBeVisible();

  await page.getByTestId('composer-model').selectOption('gpt-5.6-codex');
  await page.getByTestId('model-this-turn').click();
  await page.getByTestId('composer-permission-mode').selectOption('Default');
  await page.getByTestId('composer-thinking').selectOption('High');
  await page.getByTestId('composer-fast').click();
  await page.getByTestId('composer-input').fill('Review the current changes and preserve the endpoint contracts.');
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('toast-status')).toContainText('sent');

  await chooseDemo(page, 'permission');
  await page.getByTestId('permission-allow-once').click();
  await chooseDemo(page, 'question');
  await page.getByLabel('Compatibility first').check();
  await page.getByTestId('question-answer').click();

  await chooseDemo(page, 'running');
  await page.getByTestId('inspector-changes').click();
  await page.getByTestId('changes-scope-branch').click();
  await expect(page.getByTestId('inspector-trace')).toContainText('mode=branch');
  await page.getByTestId('changes-export').click();
  await expect(page.getByTestId('inspector-trace')).toContainText('/vcs/diff/raw');
  await page.getByTestId('inspector-files').click();
  await page.getByTestId('file-search').fill('session-manager');
  await page.getByTestId('file-src-agents-session-manager-ts').click();
  await page.getByTestId('inspector-terminal').click();
  await page.getByTestId('terminal-input').fill('git status --short');
  await page.getByTestId('terminal-run').click();
  await expect(page.getByTestId('todo-todo-review')).toBeDisabled();

  await page.getByRole('button', { name: /Volunteer coverage audit/ }).last().click();
  await expect(page.getByTestId('child-back')).toBeVisible();
  await page.getByTestId('child-back').click();
  await page.getByTestId('revert-msg-assistant-handoff').click();
  await page.getByTestId('unrevert').click();
  await page.getByTestId('summarize-msg-assistant-handoff').click();

  await chooseDemo(page, 'offline');
  await page.getByTestId('composer-input').fill('Deliver this only after reconnect.');
  await page.getByTestId('composer-send').click();
  await page.getByTestId('reconnect-button').click();
  await expect(page.getByTestId('transcript').getByText('Deliver this only after reconnect.')).toBeVisible();

  await page.getByTestId('account-button').click();
  await page.getByTestId('demo-states-button').click();
  await page.getByTestId('fixture-reset').click();
  await expect(page.getByRole('heading', { name: 'Sunday service handoff' })).toBeVisible();
});
