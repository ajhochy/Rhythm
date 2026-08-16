import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const templateId = 'template-sunday-service';
const instanceId = 'instance-sunday-service-2026-08-16';
const stepId = 'step-final-run-sheet';
const milestoneId = 'milestone-service-ready';

async function expectProjectsPage(page: Page) {
  await expect(page.getByTestId('page-projects')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toHaveCount(1);
}

test('issue-2005-c1: projects route and deep links render distinct real surfaces', async ({ page }) => {
  // Regression caught: #/projects keeps rendering ModulePlaceholder or deep links lose the chosen template/instance surface.
  await openPage(page, 'projects');
  await expectProjectsPage(page);
  await expect(page.getByTestId('projects-mode-active')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('page-trace')).toContainText('GET /project-templates → 200');
  await expect(page.getByTestId('page-trace')).toContainText('GET /project-instances → 200');

  await openPage(page, `projects/templates/${templateId}`);
  await expectProjectsPage(page);
  await expect(page.getByTestId('projects-mode-templates')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`project-template-${templateId}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('project-template-steps-panel')).toBeVisible();

  await openPage(page, `projects/templates/${templateId}/instances`);
  await expect(page.getByTestId('project-template-instances-panel')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText(`GET /project-instances?templateId=${templateId} → 200`);

  await openPage(page, `projects/instances/${instanceId}`);
  await expect(page.getByTestId(`project-instance-${instanceId}`)).toHaveAttribute('aria-expanded', 'true');
});

test('issue-2005-c2: template create edit and delete validate and receipt exactly', async ({ page }) => {
  // Regression caught: blank templates are inserted, edits update the wrong card, or deletion skips confirmation/receipt.
  await openPage(page, 'projects/templates');
  await expectProjectsPage(page);
  await page.getByTestId('project-template-new').click();
  const dialog = page.getByTestId('project-template-dialog');
  await dialog.getByTestId('project-template-submit').click();
  await expect(dialog.getByTestId('project-template-name')).toBeFocused();
  await expect(page.getByTestId('page-trace').getByText(/POST \/project-templates /)).toHaveCount(0);

  await dialog.getByTestId('project-template-name').fill('Community meal launch');
  await dialog.getByTestId('project-template-description').fill('Coordinate the multilingual welcome meal.');
  await dialog.getByTestId('project-template-submit').click();
  const created = page.getByTestId('project-template-template-community-meal-launch');
  await expect(created).toContainText('Community meal launch');
  await expect(page.getByTestId('page-trace')).toContainText('POST /project-templates {name,description} → 201');

  await created.getByTestId('project-template-edit-template-community-meal-launch').click();
  await page.getByTestId('project-template-name').fill('Community meal launch — revised');
  await page.getByTestId('project-template-submit').click();
  await expect(created).toContainText('Community meal launch — revised');
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /project-templates/template-community-meal-launch {name,description} → 200');

  await created.getByTestId('project-template-delete-template-community-meal-launch').click();
  const confirm = page.getByTestId('project-template-delete-dialog');
  await expect(confirm).toContainText('Community meal launch — revised');
  await confirm.getByTestId('project-template-delete-confirm').click();
  await expect(created).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText('DELETE /project-templates/template-community-meal-launch → 204');
});

test('issue-2005-c3: template steps validate preserve ordering and use nested receipts', async ({ page }) => {
  // Regression caught: signed offsets are discarded, visible chronology follows stale insertion order, or nested step routes are wrong.
  await openPage(page, `projects/templates/${templateId}`);
  await expectProjectsPage(page);
  await page.getByTestId('project-step-add').click();
  const dialog = page.getByTestId('project-template-step-dialog');
  await dialog.getByTestId('project-step-submit').click();
  await expect(dialog.getByTestId('project-step-title')).toBeFocused();
  await expect(page.getByTestId('page-trace').getByText(/POST \/project-templates\/.*\/steps/)).toHaveCount(0);

  await dialog.getByTestId('project-step-title').fill('Publish welcome signage');
  await dialog.getByTestId('project-step-offset-days').fill('-14');
  await dialog.getByTestId('project-step-assignee').selectOption('7');
  await dialog.getByTestId('project-step-description').fill('Two weeks before');
  await dialog.getByTestId('project-step-submit').click();
  await expect(page.getByTestId('page-trace')).toContainText(`POST /project-templates/${templateId}/steps {title,offsetDays,offsetDescription,sortOrder,assigneeId} → 201`);

  const offsets = await page.locator('[data-testid^="project-template-step-"] [data-testid="project-step-offset-value"]').allTextContents();
  expect(offsets.map(Number)).toEqual([...offsets.map(Number)].sort((left, right) => left - right));
  const created = page.getByTestId('project-template-step-step-publish-welcome-signage');
  await expect(created.getByTestId('project-step-sort-order')).toHaveText('4');

  await created.getByTestId('project-step-edit-step-publish-welcome-signage').click();
  await page.getByTestId('project-step-offset-days').fill('-21');
  await page.getByTestId('project-step-submit').click();
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /project-templates/${templateId}/steps/step-publish-welcome-signage {title,offsetDays,offsetDescription,assigneeId} → 200`);
  await expect(created.getByTestId('project-step-sort-order')).toHaveText('4');

  await created.getByTestId('project-step-delete-step-publish-welcome-signage').click();
  await page.getByTestId('project-step-delete-confirm').click();
  await expect(created).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /project-templates/${templateId}/steps/step-publish-welcome-signage → 204`);
  await expect(page.getByTestId('project-step-reorder')).toHaveCount(0);
});

test('issue-2005-c4: start project previews validates generates and shows success', async ({ page }) => {
  // Regression caught: Start enables without an anchor, preview order is wrong, or generation omits the exact template route/payload.
  await openPage(page, `projects/templates/${templateId}`);
  await expectProjectsPage(page);
  await page.getByTestId('project-start').click();
  const dialog = page.getByTestId('project-start-dialog');
  await expect(dialog.getByTestId('project-start-submit')).toBeDisabled();
  await dialog.getByTestId('project-instance-name').fill('Sunday Service — August 23');
  await dialog.getByTestId('project-anchor-date').fill('2026-08-23');
  await expect(dialog.getByTestId('project-date-preview')).toContainText('Resolved dates');
  const previewDates = await dialog.locator('[data-testid^="project-preview-date-"]').allTextContents();
  expect(previewDates).toEqual([...previewDates].sort());
  const traceBefore = await page.getByTestId('page-trace').textContent();
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
  await dialog.getByTestId('project-start-submit').click();
  await expect(dialog.getByTestId('project-start-success')).toContainText('Project started successfully');
  await expect(dialog.getByTestId('project-start-success')).toContainText('Sunday Service — August 23');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /project-templates/${templateId}/generate {anchorDate,name} → 201`);
});

test('issue-2005-c5: completion filtering and derived instance status stay consistent', async ({ page }) => {
  // Regression caught: completion hides the wrong step, Show completed fabricates a receipt, or instance status stays stale after final-step toggles.
  await openPage(page, `projects/instances/${instanceId}`);
  await expectProjectsPage(page);
  await expect(page.getByTestId(`project-instance-step-${stepId}`)).toBeVisible();
  await expect(page.getByTestId(`project-instance-instance-finished-service`)).toHaveCount(0);
  const traceBefore = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('projects-show-completed').click();
  await expect(page.getByTestId(`project-instance-instance-finished-service`)).toBeVisible();
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');

  await page.getByTestId(`project-step-complete-${stepId}`).check();
  await expect(page.getByTestId(`project-instance-status-${instanceId}`)).toHaveText('Done');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /project-instances/steps/${stepId} {status:"done",assigneeId} → 200`);
  await page.getByTestId(`project-step-complete-${stepId}`).uncheck();
  await expect(page.getByTestId(`project-instance-status-${instanceId}`)).toHaveText('Active');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /project-instances/steps/${stepId} {status:"open",assigneeId} → 200`);
});

test('issue-2005-c6: project step inspector edits supported fields and preserves context', async ({ page }) => {
  // Regression caught: inspector saves unsupported fields, loses project people context, or allows an invalid schedule without warning.
  await openPage(page, `projects/instances/${instanceId}`);
  await expectProjectsPage(page);
  await page.getByTestId(`project-step-inspect-${stepId}`).click();
  const inspector = page.getByTestId('project-step-direct-editor');
  await expect(inspector).toContainText('Project owner');
  await expect(inspector.getByTestId('project-step-title')).toBeEnabled();
  await expect(inspector.getByTestId('project-step-save')).toBeVisible();
  await inspector.getByTestId('project-step-title').fill('Finalize run sheet and cues');
  await inspector.getByTestId('project-step-notes').fill('Include bilingual welcome cues.');
  await inspector.getByTestId('project-step-scheduled-date').fill('2026-08-16');
  await inspector.getByTestId('project-step-due-date').fill('2026-08-15');
  await expect(page.getByTestId('project-step-schedule-warning')).toContainText('scheduled after its deadline');
  await inspector.getByTestId('project-step-assignee').selectOption('7');
  await inspector.getByTestId('project-step-save').click();
  await expect(page.getByTestId(`project-instance-step-${stepId}`)).toContainText('Finalize run sheet and cues');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /project-instances/steps/${stepId} {title,notes,dueDate,scheduledDate,assigneeId} → 200`);
});

test('issue-2005-c7: collaborator changes enforce owner rules and exact receipts', async ({ page }) => {
  // Regression caught: owner/existing users remain candidates, People changes only locally, or non-owner mutation stays enabled.
  await openPage(page, `projects/instances/${instanceId}`);
  await expectProjectsPage(page);
  const reloadReceipt = page.getByTestId('page-trace').getByText('GET /project-instances → 200', { exact: true });
  const reloadsBefore = await reloadReceipt.count();
  await page.getByTestId('project-collaborator-add').click();
  const picker = page.getByTestId('project-collaborator-picker');
  await expect(picker.getByRole('option', { name: /AJ Hochhalter/ })).toHaveCount(0);
  await expect(picker.getByRole('option', { name: /Morgan Lee/ })).toHaveCount(0);
  await picker.getByRole('option', { name: /Visalia CRC/ }).click();
  await expect(page.getByTestId('project-collaborator-7')).toContainText('Visalia CRC');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /project-instances/${instanceId}/collaborators {userId} → 201`);
  await expect(reloadReceipt).toHaveCount(reloadsBefore + 1);

  await page.getByTestId('project-collaborator-remove-7').click();
  await expect(page.getByTestId('project-collaborator-7')).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /project-instances/${instanceId}/collaborators/7 → 204`);
  await expect(reloadReceipt).toHaveCount(reloadsBefore + 2);

  await openPage(page, `projects/instances/${instanceId}`, '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('project owner');
  await expect(page.getByTestId('project-collaborator-add')).toBeDisabled();
  await expect(page.getByTestId(`project-step-inspect-${stepId}`)).toBeEnabled();
});

test('issue-2005-c8: milestones add assign ungroup and delete update the timeline', async ({ page }) => {
  // Regression caught: blank milestones appear, assignment targets another project, or deleting a milestone strands its steps.
  await openPage(page, `projects/instances/${instanceId}`);
  await expectProjectsPage(page);
  await page.getByTestId('project-milestone-add').click();
  const dialog = page.getByTestId('project-milestone-dialog');
  await dialog.getByTestId('project-milestone-submit').click();
  await expect(dialog.getByTestId('project-milestone-title')).toBeFocused();
  await expect(page.getByTestId('page-trace').getByText(/POST \/project-instances\/.*\/milestones/)).toHaveCount(0);
  await dialog.getByTestId('project-milestone-title').fill('Volunteer briefing');
  await dialog.getByTestId('project-milestone-submit').click();
  await expect(page.getByTestId('project-milestone-milestone-volunteer-briefing')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText(`POST /project-instances/${instanceId}/milestones {title,sortOrder} → 201`);

  await page.getByTestId(`project-step-milestone-${stepId}`).selectOption('milestone-volunteer-briefing');
  await expect(page.getByTestId('project-milestone-milestone-volunteer-briefing')).toContainText('Finalize the run sheet');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /project-instances/steps/${stepId} {milestoneId} → 200`);
  await page.getByTestId(`project-step-milestone-${stepId}`).selectOption('');
  await expect(page.getByTestId('project-milestone-ungrouped')).toContainText('Finalize the run sheet');

  await page.getByTestId(`project-step-milestone-${stepId}`).selectOption(milestoneId);
  await page.getByTestId(`project-milestone-delete-${milestoneId}`).click();
  const milestoneConfirm = page.getByTestId('project-milestone-delete-dialog');
  await expect(milestoneConfirm).toContainText('Service ready');
  await milestoneConfirm.getByTestId('project-milestone-delete-cancel').click();
  await expect(page.getByTestId(`project-milestone-${milestoneId}`)).toBeVisible();
  await page.getByTestId(`project-milestone-delete-${milestoneId}`).click();
  await page.getByTestId('project-milestone-delete-confirm').click();
  await expect(page.getByTestId(`project-milestone-${milestoneId}`)).toHaveCount(0);
  await expect(page.getByTestId('project-milestone-ungrouped')).toContainText('Finalize the run sheet');
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /project-instances/${instanceId}/milestones/${milestoneId} → 204`);
});

test('issue-2005-c9: active project delete removes only its instance with exact receipt', async ({ page }) => {
  // Regression caught: delete mutates a template/neighbor instance, fabricates archive/status support, or leaves count and receipt stale.
  await openPage(page, 'projects');
  await expectProjectsPage(page);
  const countBefore = Number(await page.getByTestId('projects-instance-count').textContent());
  await page.getByTestId(`project-instance-delete-${instanceId}`).click();
  const confirm = page.getByTestId('project-instance-delete-dialog');
  await expect(confirm).toContainText('Sunday Service - August 16');
  await confirm.getByTestId('project-instance-delete-cancel').click();
  await expect(page.getByTestId(`project-instance-${instanceId}`)).toBeVisible();
  await page.getByTestId(`project-instance-delete-${instanceId}`).click();
  await page.getByTestId('project-instance-delete-confirm').click();
  await expect(page.getByTestId(`project-instance-${instanceId}`)).toHaveCount(0);
  await expect(page.getByTestId('projects-instance-count')).toHaveText(String(countBefore - 1));
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /project-instances/${instanceId} → 204`);
  await page.getByTestId('projects-mode-templates').click();
  await expect(page.getByTestId(`project-template-${templateId}`)).toBeAttached();
  await expect(page.getByTestId('project-instance-archive')).toHaveCount(0);
  await expect(page.getByTestId('project-instance-status-edit')).toHaveCount(0);
});

test('issue-2005-c10: projects state matrix exposes recovery empties and prerequisites', async ({ page }) => {
  // Regression caught: a state is blank/dead, Retry requires reload, or readonly styling leaves a mutation enabled.
  await openPage(page, 'projects', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading projects');

  await openPage(page, 'projects/templates', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No templates yet');
  await page.getByTestId('projects-empty-create-template').click();
  await expect(page.getByTestId('project-template-name')).toBeFocused();

  await openPage(page, 'projects', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectProjectsPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'projects', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('project owner');
  await openPage(page, 'projects', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText('project service');
  await openPage(page, `projects/instances/${instanceId}`, '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText('read-only');
  await expect(page.getByTestId('projects-mutations')).toBeDisabled();
  await expect(page.getByTestId(`project-step-inspect-${stepId}`)).toBeEnabled();

  await openPage(page, 'projects', '?state=empty');
  await expect(page.getByTestId('projects-no-active')).toContainText('No active projects yet');
  await page.getByTestId('projects-empty-open-templates').click();
  await expect(page).toHaveURL(/#\/projects\/templates/);
  await openPage(page, 'projects/templates/template-empty');
  await expect(page.getByTestId('projects-no-template-steps')).toContainText('No steps yet');
  await page.getByTestId('project-step-add').click();
  await expect(page.getByTestId('project-step-title')).toBeFocused();
});

test('issue-2005-c11: enabled controls are live identifiable and receipt honest', async ({ page }) => {
  // Regression caught: an unlabeled enabled control is dead or client selection/filtering adds a fake API receipt.
  await openPage(page, `projects/instances/${instanceId}`);
  await expectProjectsPage(page);
  const enabled = page.getByTestId('page-projects').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const traceBefore = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('projects-show-completed').click();
  await page.getByTestId('projects-mode-templates').click();
  await page.getByTestId(`project-template-${templateId}`).click();
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
  await expect(page.getByTestId('project-milestone-update')).toHaveCount(0);
  await expect(page.getByTestId('project-instance-goal')).toHaveCount(0);
});

test('issue-2005-c12: projects and dialogs are accessible with focus recovery', async ({ page }) => {
  // Regression caught: dense rails/dialogs pass visual review while axe finds serious issues or Escape strands focus.
  const expectNoSeriousAxe = async () => {
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  };

  await openPage(page, 'projects/templates');
  await expectProjectsPage(page);
  await expectNoSeriousAxe();

  const templateTrigger = page.getByTestId('project-template-new');
  await templateTrigger.focus();
  await templateTrigger.click();
  await expect(page.getByTestId('project-template-dialog')).toHaveAttribute('role', 'dialog');
  await expectNoSeriousAxe();
  await page.keyboard.press('Escape');
  await expect(templateTrigger).toBeFocused();

  await page.getByTestId(`project-template-${templateId}`).click();
  const stepTrigger = page.getByTestId('project-step-add');
  await stepTrigger.focus();
  await stepTrigger.click();
  await expect(page.getByTestId('project-template-step-dialog')).toHaveAttribute('role', 'dialog');
  await expectNoSeriousAxe();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('project-template-step-dialog')).toHaveCount(0);
  await expect(stepTrigger).toBeFocused();

  await openPage(page, `projects/instances/${instanceId}`);
  const milestoneTrigger = page.getByTestId('project-milestone-add');
  await milestoneTrigger.focus();
  await milestoneTrigger.click();
  await expect(page.getByTestId('project-milestone-dialog')).toHaveAttribute('role', 'dialog');
  await expectNoSeriousAxe();
  await page.keyboard.press('Escape');
  await expect(milestoneTrigger).toBeFocused();

  const collaboratorTrigger = page.getByTestId('project-collaborator-add');
  await collaboratorTrigger.focus();
  await collaboratorTrigger.click();
  await expect(page.getByTestId('project-collaborator-picker')).toHaveAttribute('role', 'dialog');
  await expectNoSeriousAxe();
  await page.keyboard.press('Escape');
  await expect(collaboratorTrigger).toBeFocused();

  const inspectorTrigger = page.getByTestId(`project-step-inspect-${stepId}`);
  await inspectorTrigger.focus();
  await inspectorTrigger.click();
  await expect(page.getByTestId('project-step-direct-editor')).toBeVisible();
  await expectNoSeriousAxe();
});

test('issue-2005-c13: projects remains responsive at required widths text scale and rtl', async ({ page }) => {
  // Regression caught: the template rail/timeline overflows or hides primary actions at required breakpoints and localization modes.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, `projects/templates/${templateId}`);
    await expectProjectsPage(page);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('projects-mode-active')).toBeVisible();
    await expect(page.getByTestId('project-start')).toBeVisible();
    await expect(page.getByTestId('project-step-add')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('إطلاق خدمة المجتمع - 准备礼拜 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
  await expect(page.getByTestId('project-start')).toBeVisible();
});

test('issue-2005-c14: fixture isolation blocks external I O and reload resets deterministically', async ({ page }) => {
  // Regression caught: Projects calls production/localhost services or persists a mutation across deterministic fixture reload.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, `projects/instances/${instanceId}`);
  await expectProjectsPage(page);
  const seededSnapshot = await page.getByTestId('projects-fixture-snapshot').textContent();
  await page.getByTestId(`project-step-complete-${stepId}`).click();
  await expect(page.getByTestId(`project-instance-${instanceId}`)).toHaveCount(0);
  await page.reload();
  await expectProjectsPage(page);
  await expect(page.getByTestId(`project-step-complete-${stepId}`)).not.toBeChecked();
  await expect(page.getByTestId('projects-fixture-snapshot')).toHaveText(seededSnapshot ?? '');
  expect(attemptedExternal).toEqual([]);
});

test('issue-2005-c15: active projects use a persistent list and synchronized detail inspector', async ({ page }) => {
  // Regression caught: projects expand into stacked cards, or selecting another row replaces the list instead of updating the supporting inspector.
  await openPage(page, 'projects');
  await expectProjectsPage(page);

  const list = page.getByTestId('projects-list-pane');
  const inspector = page.getByTestId('project-inspector');
  await expect(list).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Sunday Service - August 16');
  await expect(page.getByTestId(`project-instance-expand-${instanceId}`)).toHaveAttribute('aria-pressed', 'true');

  const weekendId = 'instance-weekend-service-2026-08-23';
  await page.getByTestId(`project-instance-expand-${weekendId}`).click();
  await expect(list).toBeVisible();
  await expect(inspector).toContainText('Weekend Service - August 23');
  await expect(page.getByTestId(`project-instance-expand-${weekendId}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`project-instance-expand-${instanceId}`)).toHaveAttribute('aria-pressed', 'false');
  await expect(inspector).toContainText('Project owner');
  await expect(inspector).toContainText('Milestones and steps');
});
