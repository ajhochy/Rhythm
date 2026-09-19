import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';
import {
  atNarrow,
  atZoom200,
  expectInspectorHeading,
  expectListInspectorAxeClean,
  expectSelected,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';

const template = 'Sunday Service Launch';
const project = 'Sunday Service - August 16';
const weekendProject = 'Weekend Service - August 23';
const instanceId = 'instance-sunday-service-2026-08-16';
const stepId = 'step-final-run-sheet';

test.describe('Projects shared list and inspector', () => {
  test('selects templates and active projects while keeping every item action in the inspector', async ({ page }) => {
    // Regression caught: Projects forks the shared pattern or leaves item actions inside interactive list rows.
    await openPage(page, 'projects');
    await expectSelected(page, project);
    await expectInspectorHeading(page, project);

    await selectRow(page, template);
    await expectInspectorHeading(page, template);
    const detail = page.getByTestId('list-inspector-detail');
    for (const id of [
      'project-template-edit-template-sunday-service',
      'project-template-delete-template-sunday-service',
      'project-start',
      'project-template-tab-steps',
      'project-template-tab-instances',
      'project-step-add',
      'project-step-edit-template-step-volunteer-plan',
      'project-step-delete-template-step-volunteer-plan',
    ]) await expect(detail.getByTestId(id)).toBeVisible();

    await selectRow(page, weekendProject);
    await expectInspectorHeading(page, weekendProject);
    for (const id of [
      'project-instance-delete-instance-weekend-service-2026-08-23',
      'project-collaborator-add',
      'project-collaborator-remove-2',
      'project-milestone-add',
      'project-milestone-delete-milestone-weekend-welcome',
      'project-step-complete-step-weekend-community-welcome',
      'project-step-milestone-step-weekend-community-welcome',
      'project-step-inspect-step-weekend-community-welcome',
    ]) await expect(detail.getByTestId(id)).toBeVisible();
    await expectListInspectorAxeClean(page);
  });

  test('supports roving keyboard focus and selection across groups', async ({ page }) => {
    // Regression caught: Arrow keys focus a row but Enter/Space does not update the shared inspector.
    await openPage(page, 'projects/templates');
    await expectSelected(page, template);
    await keyboardSelect(page, { fromTitle: template, presses: ['ArrowDown', 'Space'] });
    await expectInspectorHeading(page, 'إطلاق خدمة المجتمع - 准备礼拜 🎵');
    await keyboardSelect(page, { fromTitle: 'إطلاق خدمة المجتمع - 准备礼拜 🎵', presses: ['End', 'Enter'] });
    await expectInspectorHeading(page, weekendProject);
    await expectListInspectorAxeClean(page);
  });

  test('restores selection, shows missing and deleted ids, and never leaves stale actions', async ({ page }) => {
    // Regression caught: refresh loses projectId or a removed item leaves its old inspector actionable.
    await openPage(page, 'projects', '?projectId=project-instance-instance-weekend-service-2026-08-23&retained=keep-me');
    await expectSelected(page, weekendProject);
    await expectInspectorHeading(page, weekendProject);
    await page.reload();
    await expectInspectorHeading(page, weekendProject);
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('retained')).toBe('keep-me');

    await openPage(page, 'projects', '?projectId=project-instance-deleted-project');
    await expectInspectorHeading(page, 'Item not found');
    await expect(page.getByTestId('list-inspector-detail')).not.toContainText('Project owner');
    await expect(page.getByTestId(`project-instance-delete-${instanceId}`)).toHaveCount(0);

    await selectRow(page, project);
    await page.getByTestId(`project-instance-delete-${instanceId}`).click();
    await page.getByTestId('project-instance-delete-confirm').click();
    await expectInspectorHeading(page, 'Item not found');
    await expect(page.getByRole('option', { name: project, exact: true })).toHaveCount(0);
    await expect(page.getByTestId(`project-instance-delete-${instanceId}`)).toHaveCount(0);
  });

  test('prompts before selection discards an unsaved step edit', async ({ page }) => {
    // Regression caught: choosing a different row silently discards an edited step draft.
    await openPage(page, 'projects');
    await page.getByTestId(`project-step-inspect-${stepId}`).click();
    await page.getByTestId('project-step-notes').fill('Unsaved selection guard');

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('unsaved step edits');
      await dialog.dismiss();
    });
    await page.getByRole('option', { name: weekendProject, exact: true }).click();
    await expectSelected(page, project);
    await expectInspectorHeading(page, project);
    await expect(page.getByTestId('project-step-notes')).toHaveValue('Unsaved selection guard');

    page.once('dialog', (dialog) => dialog.accept());
    await selectRow(page, weekendProject);
    await expectSelected(page, weekendProject);
    await expectInspectorHeading(page, weekendProject);
    await expect(page.getByTestId('project-step-direct-editor')).toHaveCount(0);
  });

  test('retains empty, loading, error recovery, and read-only inspection states', async ({ page }) => {
    // Regression caught: state fixtures bypass the primitive or read-only mode hides details with its actions enabled.
    await openPage(page, 'projects', '?state=loading');
    await expect(page.locator('.list-inspector-state[role="status"]')).toContainText('Loading Projects');
    await expect(page.getByRole('option')).toHaveCount(0);

    await openPage(page, 'projects', '?state=empty');
    await expect(page.getByTestId('page-state-empty')).toContainText('No active projects yet');
    await expect(page.getByRole('option')).toHaveCount(0);

    await openPage(page, 'projects', '?state=server-error');
    await expect(page.getByTestId('page-state-server-error')).toContainText('Could not load projects');
    await page.getByTestId('page-retry').click();
    await expectInspectorHeading(page, project);

    await openPage(page, `projects/instances/${instanceId}`, '?state=readonly');
    await expectInspectorHeading(page, project);
    await expect(page.getByTestId('page-state-readonly')).toContainText('read-only');
    for (const id of [
      `project-instance-delete-${instanceId}`,
      'project-collaborator-add',
      'project-milestone-add',
      `project-step-complete-${stepId}`,
      `project-step-milestone-${stepId}`,
    ]) await expect(page.getByTestId(id)).toBeDisabled();
    await expect(page.getByTestId(`project-step-inspect-${stepId}`)).toBeEnabled();
    await expectListInspectorAxeClean(page);
  });

  test('uses one pane at 640px and keeps long content and actions available at 200% zoom', async ({ page }) => {
    // Regression caught: narrow/zoomed layouts clip the inspector toolbar or strand focus away from the selected row.
    await atNarrow(page);
    await openPage(page, 'projects');
    const list = page.getByRole('listbox', { name: 'Projects', includeHidden: true });
    await expectInspectorHeading(page, project);
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(list).toBeVisible();
    await expect(list.getByRole('option', { name: project, exact: true })).toBeFocused();
    await selectRow(page, 'إطلاق خدمة المجتمع - 准备礼拜 🎵');
    await expectInspectorHeading(page, 'إطلاق خدمة المجتمع - 准备礼拜 🎵');
    await expect(page.getByTestId('project-start')).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await atZoom200(page);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await expect(page.getByTestId('project-start')).toBeInViewport();
    const bounds = await page.locator('.projects-list-inspector').evaluate((element) => ({ content: element.scrollWidth, available: element.clientWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.available + 1);
    await expectListInspectorAxeClean(page);
  });
});
