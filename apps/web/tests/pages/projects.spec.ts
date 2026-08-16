import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const templateId = 'template-sunday-service';
const instanceId = 'instance-sunday-service-2026-08-16';
const stepId = 'step-final-run-sheet';

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

test('Projects click-through covers templates, generation, steps, people, milestones, inspection, completion, and deletion', async ({ page }) => {
  await openPage(page, 'projects/templates');
  await page.getByTestId('project-template-new').click();
  await page.getByTestId('project-template-name').fill('Community care launch');
  await page.getByTestId('project-template-description').fill('Coordinate a welcoming multilingual care night.');
  await page.getByTestId('project-template-submit').click();
  const createdTemplate = page.getByTestId('project-template-template-community-care-launch');
  await expect(createdTemplate).toBeVisible();
  await createdTemplate.getByTestId('project-template-edit-template-community-care-launch').click();
  await page.getByTestId('project-template-name').fill('Community care launch — revised');
  await page.getByTestId('project-template-submit').click();
  await expect(createdTemplate).toContainText('revised');
  await createdTemplate.getByTestId('project-template-delete-template-community-care-launch').click();
  await page.getByTestId('project-template-delete-cancel').click();
  await expect(createdTemplate).toBeVisible();

  await page.getByTestId(`project-template-${templateId}`).getByTestId(`project-template-select-${templateId}`).click();
  await page.getByTestId('project-step-add').click();
  await page.getByTestId('project-step-title').fill('Confirm welcome language');
  await page.getByTestId('project-step-offset-days').fill('-5');
  await page.getByTestId('project-step-assignee').selectOption('7');
  await page.getByTestId('project-step-submit').click();
  const createdStep = page.getByTestId('project-template-step-step-confirm-welcome-language');
  await expect(createdStep).toBeVisible();
  await createdStep.getByTestId('project-step-delete-step-confirm-welcome-language').click();
  await page.getByTestId('project-step-delete-confirm').click();
  await expect(createdStep).toHaveCount(0);

  await page.getByTestId('project-start').click();
  await page.getByTestId('project-instance-name').fill('Sunday Service — August 23');
  await page.getByTestId('project-anchor-date').fill('2026-08-23');
  await page.getByTestId('project-start-submit').click();
  await expect(page.getByTestId('project-start-success')).toContainText('Project started successfully');
  await page.getByTestId('project-start-done').click();

  await openPage(page, `projects/instances/${instanceId}`);
  await page.getByTestId('project-collaborator-add').click();
  await page.getByTestId('project-collaborator-option-7').click();
  await expect(page.getByTestId('project-collaborator-7')).toBeVisible();
  await page.getByTestId('project-collaborator-remove-7').click();
  await expect(page.getByTestId('project-collaborator-7')).toHaveCount(0);

  await page.getByTestId('project-milestone-add').click();
  await page.getByTestId('project-milestone-title').fill('Volunteer briefing');
  await page.getByTestId('project-milestone-submit').click();
  await page.getByTestId(`project-step-milestone-${stepId}`).selectOption('milestone-volunteer-briefing');
  await expect(page.getByTestId('project-milestone-milestone-volunteer-briefing')).toContainText('Finalize the run sheet');

  await page.getByTestId(`project-step-inspect-${stepId}`).click();
  // Regression caught: selecting a step required a second edit dialog before fields were available.
  await expect(page.getByTestId('project-step-direct-editor').getByTestId('project-step-notes')).toBeEnabled();
  await page.getByTestId('project-step-notes').fill('Include the multilingual welcome and livestream fallback.');
  await page.getByTestId('project-step-save').click();
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /project-instances/steps/${stepId} {title,notes,dueDate,scheduledDate,assigneeId} → 200`);

  await page.getByTestId('projects-show-completed').click();
  await page.getByTestId(`project-step-complete-${stepId}`).check();
  await expect(page.getByTestId(`project-instance-status-${instanceId}`)).toHaveText('Done');
  await page.getByTestId(`project-instance-delete-${instanceId}`).click();
  await page.getByTestId('project-instance-delete-cancel').click();
  await expect(page.getByTestId(`project-instance-${instanceId}`)).toBeVisible();
  await page.getByTestId(`project-instance-delete-${instanceId}`).click();
  await page.getByTestId('project-instance-delete-confirm').click();
  await expect(page.getByTestId(`project-instance-${instanceId}`)).toHaveCount(0);
});

test('Projects recovery and permission states preserve URL state, truthful prerequisites, and inspection', async ({ page }) => {
  await openPage(page, 'projects', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expect(page).toHaveURL(/state=ready/);
  await expect(page.getByTestId('page-trace')).toContainText('GET /project-instances → 200');

  await openPage(page, `projects/instances/${instanceId}`, '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('project owner');
  await expect(page.getByTestId('project-collaborator-add')).toBeDisabled();
  await page.getByTestId(`project-step-inspect-${stepId}`).click();
  await expect(page.getByTestId('project-step-direct-editor').getByTestId('project-step-title')).toBeDisabled();

  await openPage(page, `projects/instances/${instanceId}`, '?state=readonly');
  await expect(page.getByTestId('projects-mutations')).toBeDisabled();
  await expect(page.getByTestId('projects-mutations')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId(`project-step-complete-${stepId}`)).toBeDisabled();
  await expect(page.getByTestId(`project-step-inspect-${stepId}`)).toBeEnabled();
});

test('Projects is responsive and axe-clean across representative surfaces and dialogs', async ({ page }) => {
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, `projects/templates/${templateId}`);
    await expect(page.getByTestId('project-start')).toBeVisible();
    await expect(page.getByTestId('project-step-add')).toBeVisible();
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
  }

  await expectNoBlockingAxe(page, 'ready template');
  await page.getByTestId('project-step-add').click();
  await expectNoBlockingAxe(page, 'template step dialog');
  await page.keyboard.press('Escape');

  await openPage(page, `projects/instances/${instanceId}`);
  await expectNoBlockingAxe(page, 'ready active project');
  await page.getByTestId('project-collaborator-add').click();
  await expectNoBlockingAxe(page, 'collaborator dialog');
  await page.keyboard.press('Escape');
  await page.getByTestId('project-milestone-add').click();
  await expectNoBlockingAxe(page, 'milestone dialog');
  await page.keyboard.press('Escape');
  await page.getByTestId(`project-step-inspect-${stepId}`).click();
  await expectNoBlockingAxe(page, 'project step inspector');
  await page.keyboard.press('Escape');

  await openPage(page, 'projects', '?state=server-error');
  await expectNoBlockingAxe(page, 'server error');
  await openPage(page, `projects/instances/${instanceId}`, '?state=readonly');
  await expectNoBlockingAxe(page, 'readonly project');

  await openPage(page, `projects/templates/${templateId}`);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('إطلاق خدمة المجتمع - 准备礼拜 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
});
