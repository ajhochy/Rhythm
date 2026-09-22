import { expect, test, type Page } from '@playwright/test';
import { openFixture } from '../helpers';

// Issue 1558 — collapsed project groups in the Session Rail, persisted per project id.
//
// Fresh load collapses EVERY project group except the one that holds the selected
// session; a manual open/close of a specific project survives remount/restart via
// the existing localStorage pattern (a JSON id list under
// `rhythm-agents-projects-open`); state is per project id so a newly appearing
// project (absent from the stored list) simply stays collapsed; corrupt or
// unavailable storage falls back safely to the all-collapsed default; and the
// chevron + aria-expanded affordances stay in sync as before.
//
// Model: the rail stores the list of OPEN project ids. `expanded = open.has(id)`,
// so any project not in the list (including a brand-new one) renders collapsed.

// Canonical fixture default selection is session-sunday-handoff, whose group is
// project-ministry-ops. project-rhythm-desktop holds the other chats and is a
// clean "other project" that must default collapsed.
const SELECTED_PROJECT = 'project-ministry-ops';
const OTHER_PROJECT = 'project-rhythm-desktop';

async function openRail(page: Page) {
  await openFixture(page);
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toBeAttached();
}

// Regression caught: a plain `new Set()` default leaves every group open on fresh load.
test('issue-1558-c1: fresh load collapses every project group except the selected one', async ({ page }) => {
   // Non-selected group starts collapsed and hides its rows.
  await openRail(page);
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`).locator('..').locator('button.session-row')).toHaveCount(0);
   // Exactly one group (the selected one) is the only expanded toggle on this scope.
  const expandedCount = await page.locator('.session-list > .session-group > .group-toggle[aria-expanded="true"]').count();
  expect(expandedCount).toBe(1);
});

// Regression caught: collapse-only default hides the selected session from a returning user.
test('issue-1558-c2: the selected session\'s project group expands on fresh load', async ({ page }) => {
  await openRail(page);
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-session-sunday-handoff')).toBeVisible();
   // The non-selected group stays collapsed.
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
});

// Regression caught: a user's manual open was never persisted, so it reset on reload.
test('issue-1558-c3: a toggle survives remount/reload via localStorage', async ({ page }) => {
  await openRail(page);
   // Open the non-selected group by hand.
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).not.toBeNull();
   // A fresh load must honor the stored open state rather than reset to default.
  await page.reload();
  await openRail(page);
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
});

// Regression caught: a toggle on project A clobbered a brand-new project B, or a
// re-open of one project closed the others, because state was not keyed per project id.
test('issue-1558-c4: state is per project id and new projects default collapsed', async ({ page }) => {
  await openRail(page);
   // Open a non-selected project; the selected group stays open (c2) and independent.
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
   // Reload keeps both open because each id is stored independently.
  await page.reload();
  await openRail(page);
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
   // Closing this one group leaves the other (selected) untouched.
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
});

// Regression caught: an unavailable/corrupt key throws at mount or poisons state with
// non-project values. The reader must fall back to the all-collapsed default without
// crashing, and a subsequent toggle must write a well-formed value.
test('issue-1558-c5: corrupt or unavailable storage falls back safely', async ({ page }) => {
  await page.goto('about:blank');
  await page.addInitScript(() => {
      // Corrupt JSON: the reader must fall back to "all closed" and ignore the blob
      // instead of throwing or treating it as a valid per-project list.
     window.localStorage.setItem('rhythm-agents-projects-open', '{not-a-list');
    });
  await openFixture(page);
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toBeAttached();
   // Fallback is all-collapsed; the selected group still auto-expands.
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
   // A subsequent open must repopulate a clean, well-formed JSON id list.
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  const stored = await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'));
  expect(stored).not.toBeNull();
  expect(() => JSON.parse(stored as string)).not.toThrow();
  expect(JSON.parse(stored as string)).toContain('project-rhythm-desktop');
});

// Regression caught: chevron / aria-expanded diverge from the live open state
// (e.g. a down chevron while the group is collapsed) or only toggle one direction.
test('issue-1558-c6: chevron and aria-expanded stay in sync and toggle both ways', async ({ page }) => {
  await openRail(page);
  const other = page.getByTestId(`group-project-${OTHER_PROJECT}`);
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await other.click();
  await expect(other).toHaveAttribute('aria-expanded', 'true');
  await other.click();
  await expect(other).toHaveAttribute('aria-expanded', 'false');
});
