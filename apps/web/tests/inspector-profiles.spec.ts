import { expect, test } from '@playwright/test';
import { chooseDemo, openFixture } from './helpers';

test.describe('inspector and profile workflows', () => {
  test('collapsing the Agents rail preserves the active session and inspector', async ({ page }) => {
    // Regression: removing the rail resizer let CSS grid auto-placement move the
    // conversation into the five-pixel resizer track, making the session look cleared.
    await openFixture(page);
    const conversation = page.getByRole('region', { name: 'Active agent session' });
    const inspector = page.getByLabel('Session inspector');
    const title = page.getByRole('heading', { name: 'Sunday service handoff', level: 1 });
    const transcriptCopy = page.getByText('Prepare the Sunday service handoff.', { exact: false });
    const expandedConversation = await conversation.boundingBox();

    await expect(title).toBeVisible();
    await expect(transcriptCopy).toBeVisible();
    await expect(page.getByTestId('context-panel')).toBeVisible();
    await page.getByTestId('rail-collapse').click();

    await expect(page.getByTestId('rail-expand')).toBeVisible();
    await expect(title).toHaveText('Sunday service handoff');
    await expect(transcriptCopy).toBeVisible();
    await expect(page.getByTestId('context-panel')).toBeVisible();
    const collapsedConversation = await conversation.boundingBox();
    const preservedInspector = await inspector.boundingBox();
    expect(collapsedConversation?.width, 'active session keeps its full grid track').toBeGreaterThan(expandedConversation?.width ?? 0);
    expect(preservedInspector?.width, 'inspector keeps its configured grid track').toBeGreaterThanOrEqual(286);

    await page.getByTestId('rail-expand').click();
    await expect(title).toHaveText('Sunday service handoff');
    await expect(page.getByTestId('context-panel')).toBeVisible();
  });

  test('uses every inspector view, worktree actions, todos, and pane controls', async ({ page }) => {
    await openFixture(page);
    await expect(page.getByTestId('context-panel')).toBeVisible();
    await page.getByTestId('inspector-changes').click();
    await expect(page.getByTestId('changes-panel')).toContainText('changed files');
    await page.getByTestId('changes-scope-branch').click();
    await expect(page.getByTestId('inspector-trace')).toContainText('mode=branch');
    await page.getByTestId('changes-scope-session').click();
    await page.getByTestId('change-file-services-2026-08-16-owners-md').click();
    await expect(page.getByText('+ Livestream fallback: unresolved')).toBeVisible();
    await page.getByTestId('changes-export').click();
    await expect(page.getByTestId('inspector-trace')).toContainText('/vcs/diff/raw');
    await page.getByTestId('changes-revert').click();
    await page.getByTestId('worktree-confirm').click();
    await expect(page.getByTestId('toast-status')).toContainText('reverted');
    await page.getByTestId('changes-restore').click();
    await page.getByTestId('worktree-confirm').click();
    await expect(page.getByTestId('toast-status')).toContainText('restored');
    await page.getByTestId('worktree-reset').click();
    await page.getByTestId('worktree-confirm').click();
    await expect(page.getByTestId('toast-status')).toContainText('reset');
    await expect(page.getByTestId('worktree-remove')).toBeDisabled();
    await page.getByTestId('inspector-terminal').click();
    await page.getByTestId('terminal-input').fill('npm test');
    await page.getByTestId('terminal-run').click();
    await expect(page.getByTestId('terminal-output')).toContainText('26 tests discovered');
    await page.getByTestId('terminal-input').fill('exit');
    await page.getByTestId('terminal-run').click();
    await expect(page.getByTestId('terminal-output')).toContainText('[process exited]');
    await page.getByTestId('terminal-new').click();
    await page.getByTestId('inspector-context').click();
    await page.getByTestId('inspector-terminal').click();
    await expect(page.getByTestId('terminal-output')).toContainText('/workspace/rhythm');
    await page.getByTestId('inspector-files').click();
    await page.getByTestId('file-search').fill('session-manager');
    await page.getByTestId('file-src-agents-session-manager-ts').click();
    await expect(page.getByText('queueLocalInput')).toBeVisible();
    await page.getByTestId('file-search').fill('rhythm-logo');
    await page.getByTestId('file-assets-rhythm-logo-png').click();
    await expect(page.getByAltText('Preview of assets/rhythm-logo.png')).toBeVisible();
    await page.getByTestId('file-search').fill('rhythm-agent');
    await page.getByTestId('file-build-rhythm-agent').click();
    await expect(page.getByText('Binary file')).toBeVisible();
    await page.getByTestId('file-search').fill('full-transcript');
    await page.getByTestId('file-exports-full-transcript-json').click();
    await expect(page.getByText('File exceeds the 2 MB preview limit.')).toBeVisible();
    await chooseDemo(page, 'completed');
    await page.getByTestId('inspector-artifacts').click();
    await expect(page.getByTestId('open-artifact-report')).toBeVisible();
    await expect(page.getByTestId('artifact-preview')).toBeVisible();
    await page.getByTestId('artifact-history-retry').click();
    await expect(page.getByText('Earlier history loaded · 2 unique artifacts')).toBeVisible();
    await page.getByTestId('artifact-selector').selectOption('artifact-runbook');
    await expect(page.getByTestId('open-artifact-runbook')).toBeVisible();
    await expect(page.getByTestId('todo-todo-review')).toBeDisabled();
    await page.getByTestId('todo-toggle').click();
    await expect(page.getByTestId('todo-todo-review')).toHaveCount(0);
    await page.getByTestId('todo-toggle').click();
    await page.getByTestId('inspector-collapse').click();
    await expect(page.getByTestId('inspector-expand')).toBeVisible();
    await expect(page.getByTestId('inspector-expand')).toBeFocused();
    const collapsedBounds = await page.getByTestId('inspector-collapsed').boundingBox();
    expect(collapsedBounds?.width).toBeGreaterThanOrEqual(56);
    for (const tab of ['context', 'changes', 'terminal', 'files', 'artifacts']) {
      const control = page.getByTestId(`inspector-collapsed-${tab}`);
      const bounds = await control.boundingBox();
      expect(bounds?.width, `${tab} width`).toBeGreaterThanOrEqual(44);
      expect(bounds?.height, `${tab} height`).toBeGreaterThanOrEqual(44);
      expect(bounds?.x, `${tab} left edge`).toBeGreaterThanOrEqual(collapsedBounds?.x ?? 0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0), `${tab} right edge`).toBeLessThanOrEqual((collapsedBounds?.x ?? 0) + (collapsedBounds?.width ?? 0));
    }
    await page.getByTestId('inspector-expand').click();
    await expect(page.getByTestId('inspector-collapse')).toBeFocused();
    await page.getByTestId('rail-collapse').click();
    await expect(page.getByTestId('rail-expand')).toBeVisible();
    await page.getByTestId('rail-expand').click();
    await page.getByTestId('rail-resizer').focus();
    await page.keyboard.press('ArrowRight');
  });

  test('creates, edits, renames, defaults, duplicates, refreshes capabilities, and deletes profiles', async ({ page }) => {
    await openFixture(page, '#/profiles');
    await page.getByTestId('profile-create').click();
    await page.getByTestId('profile-rename').click();
    await page.getByTestId('profile-inline-name').fill('Release Steward');
    await page.getByTestId('profile-inline-confirm').click();
    await page.getByTestId('profile-icon').fill('RS');
    await page.getByTestId('profile-system-prompt').fill('Prepare releases, preserve scope, and verify every handoff.');
    await page.getByTestId('profile-manager').check();
    await page.getByTestId('delegate-profile-builder').check();
    await page.getByTestId('profile-provider').selectOption('Anthropic');
    await page.getByTestId('profile-model').selectOption('claude-sonnet-4');
    await page.getByTestId('mcp-gitnexus').check();
    await page.getByTestId('skill-verification').check();
    await page.getByTestId('permission-shell-allow').check();
    await page.getByTestId('profile-managed-skills').check();
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('toast-status')).toContainText('saved');
    await page.getByTestId('profile-default').click();
    await expect(page.getByTestId('toast-status')).toContainText('Default');
    await page.getByTestId('profile-duplicate').click();
    await expect(page.getByRole('heading', { name: /copy/ })).toBeVisible();
    await page.getByTestId('profile-resync').click();
    await expect(page.getByTestId('toast-status')).toContainText('refreshed');
    await page.getByTestId('profile-delete').click();
    await page.getByTestId('confirm-profile-delete').click();
    await expect(page.getByTestId('toast-status')).toContainText('deleted');
  });
});
