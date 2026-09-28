import { chromium, expect, test, type Page } from '@playwright/test';
import { openFixture } from '../helpers';

// Issue 1558 — collapsed project groups in the Session Rail, persisted per project id.
//
// `rhythm-agents-projects-open` stores only explicit user choices as a boolean record.
// The selected session's group auto-opens for each mount even when explicitly false,
// without rewriting storage; absent/new/unassigned groups otherwise stay closed.
// Corrupt/unavailable storage behaves like an empty record.

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
  const expandedCount = await page.locator('.session-list > .session-group > .session-group-heading > .group-toggle[aria-expanded="true"]').count();
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

// Regression caught: a persisted false hid the selected session after a document remount.
test('issue-1558-c3: a selected group closes immediately but auto-opens after document remount', async ({ page }) => {
  await openRail(page);
  const selected = page.getByTestId(`group-project-${SELECTED_PROJECT}`);
  await selected.click();
  await expect(selected).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).toBe(JSON.stringify({ [SELECTED_PROJECT]: false }));

  // The mount-only override reveals the selected session without rewriting its preference.
  await page.reload();
  await openRail(page);
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-session-sunday-handoff')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).toBe(JSON.stringify({ [SELECTED_PROJECT]: false }));
});

// Regression caught: a profile recreation via storageState is not a process restart.
// Exercise true and false preferences plus the selected-group override across real relaunches.
test('issue-1558-c3b: selected override and per-project preferences survive persistent-profile relaunches', async ({ baseURL }, testInfo) => {
  test.slow();
  const userDataDir = testInfo.outputPath('persistent-profile');
  const launch = () => chromium.launchPersistentContext(userDataDir, { baseURL, viewport: { width: 1440, height: 900 }, timezoneId: 'America/Los_Angeles', locale: 'en-US', colorScheme: 'light', serviceWorkers: 'block' });
  let context = await launch();
  try {
    let page = context.pages()[0] ?? await context.newPage();
    await openRail(page);
    await page.getByTestId(`group-project-${SELECTED_PROJECT}`).click();
    await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
    await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
    await context.close();
    context = await launch();
    page = context.pages()[0] ?? await context.newPage();
    await openRail(page);
    await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('session-session-permission')).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).toBe(JSON.stringify({ [SELECTED_PROJECT]: false, [OTHER_PROJECT]: true }));

    // A non-selected group's explicit false remains authoritative on the next relaunch.
    await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
    await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
    await context.close();
    context = await launch();
    page = context.pages()[0] ?? await context.newPage();
    await openRail(page);
    await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).toBe(JSON.stringify({ [SELECTED_PROJECT]: false, [OTHER_PROJECT]: false }));
  } finally { await context.close(); }
});

// Regression caught: recomputing absent groups from the current selection collapses
// the origin group when the user selects a session in another group.
test('issue-1558-c2b: moving selection never collapses the origin group', async ({ page }) => {
  await openRail(page);
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  await page.getByTestId('session-session-completed').click();
  await expect(page.getByTestId('session-session-completed')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-session-sunday-handoff')).toBeVisible();
  await page.getByTestId('session-session-sunday-handoff').click();
  await expect(page.getByTestId('session-session-sunday-handoff')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
});

// Regression caught: a toggle on project A clobbered a brand-new project B, or a
// re-open of one project closed the others, because state was not keyed per project id.
test('issue-1558-c4: state is an explicit per-project record and a new id remains absent/closed', async ({ page }) => {
  await openRail(page);
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).toBe(JSON.stringify({ [OTHER_PROJECT]: true }));

  // Reload must retain the manually opened other group without writing an implicit selected choice.
  await page.reload();
  await openRail(page);
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
});

// Regression caught: malformed JSON throws at mount instead of falling back to the
// default-collapsed state with only the selected session's group auto-opened.
test('issue-1558-c5a: corrupt JSON falls back safely without rewriting storage', async ({ page }) => {
  await openRail(page);
  await page.evaluate(() => window.localStorage.setItem('rhythm-agents-projects-open', '{malformed'));
  await page.reload();
  await openRail(page);
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-session-sunday-handoff')).toBeVisible();
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.localStorage.getItem('rhythm-agents-projects-open'))).toBe('{malformed');
});

// Regression caught: unavailable storage throws at mount or on toggle. The reader
// and writer must both fail closed without crashing the rail.
test('issue-1558-c5: throwing getItem and setItem fall back safely', async ({ page }) => {
  await page.goto('about:blank');
  await page.addInitScript(() => {
    const storage = window.localStorage;
    Storage.prototype.getItem = function(key: string) {
      if (this === storage && key === 'rhythm-agents-projects-open') throw new Error('read denied');
      return null;
    };
    Storage.prototype.setItem = function(key: string, value: string) {
      if (this === storage && key === 'rhythm-agents-projects-open') throw new Error('write denied');
    };
  });
  await openFixture(page);
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toBeAttached();
  // The real selected session still opens its group in memory.
  await expect(page.getByTestId(`group-project-${SELECTED_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'false');
    // A subsequent toggle must not crash when persistence is denied.
  await page.getByTestId(`group-project-${OTHER_PROJECT}`).click();
  await expect(page.getByTestId(`group-project-${OTHER_PROJECT}`)).toHaveAttribute('aria-expanded', 'true');
});

// Regression caught: chevron / aria-expanded diverge from the live open state
// (e.g. a down chevron while the group is collapsed) or only toggle one direction.
test('issue-1558-c6: chevron and aria-expanded stay in sync and toggle both ways', async ({ page }) => {
  await openRail(page);
  const other = page.getByTestId(`group-project-${OTHER_PROJECT}`);
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await expect(other.locator('svg.lucide-chevron-right')).toBeVisible();
  await other.click();
  await expect(other).toHaveAttribute('aria-expanded', 'true');
  await expect(other.locator('svg.lucide-chevron-down')).toBeVisible();
  await other.click();
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await expect(other.locator('svg.lucide-chevron-right')).toBeVisible();
});
