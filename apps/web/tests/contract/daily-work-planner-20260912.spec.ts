import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';

for (const width of [1440, 1024, 390]) test(`planner-textzoom-c1: ${width}px titles remain fully visible at 200% root text`, async ({ page }, testInfo) => {
  // Regression: a two-line clamp hides distinguishing title text despite a full accessible name.
  await page.setViewportSize({ width, height: 900 });
  await openPage(page, '/planner');
  const cards = page.locator('.planner-board .planner-task');
  await expect(cards).toHaveCount(108);
  const baseline = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(cards.first().locator('strong')).toHaveCSS('font-size', '26px');
  const rows = await cards.evaluateAll(nodes => nodes.map(card => {
    const title = card.querySelector<HTMLElement>('.task-main strong')!;
    const t = title.getBoundingClientRect(), c = card.getBoundingClientRect();
    const button = card.querySelector('.task-complete')!.getBoundingClientRect();
    return { text: title.textContent, font: getComputedStyle(title).fontSize, line: getComputedStyle(title).lineHeight,
      content: title.scrollHeight, visible: title.clientHeight, height: c.height,
      contained: t.top >= c.top && t.bottom <= c.bottom,
      overlap: Math.max(0, Math.min(t.right, button.right) - Math.max(t.left, button.left)) * Math.max(0, Math.min(t.bottom, button.bottom) - Math.max(t.top, button.top)),
      targetWidth: button.width, targetHeight: button.height };
  }));
  console.log(`text200 ${width}`, JSON.stringify(rows.slice(0, 15)));
  await page.screenshot({ path: testInfo.outputPath(`text200-${width}.png`) });
  for (const [i, row] of rows.entries()) {
    expect.soft(row.font).toBe('26px');
    expect.soft(row.line).toBe('36px');
    expect(row.content, row.text!).toBeLessThanOrEqual(row.visible);
    expect.soft(row.contained, row.text!).toBe(true);
    expect.soft(row.height).toBeGreaterThan(baseline[i]);
    expect.soft(row.overlap).toBe(0);
    expect.soft(row.targetWidth).toBeGreaterThanOrEqual(44);
    expect.soft(row.targetHeight).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (width === 390) await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

for (const theme of ['light', 'dark']) test(`planner-p1-c1: ${theme} project labels meet normal-text contrast`, async ({ page }, testInfo) => {
  // Regression: decorative warning yellow is used as 11px project text on a light card.
  await openPage(page, '/planner');
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  const labels = page.locator('.project-step .task-source');
  await expect(labels.first()).toBeVisible();
  const ratios = await labels.evaluateAll(nodes => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const luminance = (color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => {
        const s = v / 255;
        return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    return nodes.map(node => {
      const fg = luminance(getComputedStyle(node).color);
      const bg = luminance(getComputedStyle(node.closest('article')!).backgroundColor);
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
    });
  });
  console.log(`${theme} project contrast`, ratios);
  const cards = await page.locator('.planner-board .planner-task').evaluateAll(nodes => nodes.map(node => ({
    height: node.getBoundingClientRect().height,
    titleHeight: node.querySelector('strong')!.getBoundingClientRect().height,
  })));
  expect(cards).toHaveLength(108);
  // Unclipped long titles may use the approved <=94px bound; ordinary cards stay64px.
  for (const card of cards) {
    if (card.titleHeight <= 36) expect(card.height).toBe(64);
    else expect(card.height).toBeLessThanOrEqual(94);
  }
  console.log('default density', cards.reduce<Record<string, number>>((counts, card) => ({ ...counts, [card.height]: (counts[card.height] ?? 0) + 1 }), {}));
  await page.screenshot({ path: testInfo.outputPath(`desktop-${theme}.png`) });
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
});

test('planner-p1-c2: bottom-scroll Tab keeps the focused date below the hit-testable sticky action', async ({ page }, testInfo) => {
  // Regression: Tab from offscreen notes places a z5 date field over the sticky Complete button.
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, '/planner');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.getByTestId('planner-today').click();
  await page.getByTestId('planner-task-task-wed').click();
  await page.getByTestId('planner-edit-notes').focus();
  const body = page.getByTestId('planner-inspector').locator('.dialog-body');
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByTestId('planner-edit-notes')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('planner-edit-scheduled-date')).toBeFocused();
  const geometry = () => page.getByTestId('planner-detail-complete').evaluate(button => {
    const action = button.parentElement!.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const field = document.activeElement!.getBoundingClientRect();
    return {
      height: b.height, top: b.top, bottom: b.bottom, actionBottom: action.bottom,
      fieldTop: field.top, fieldBottom: field.bottom,
      overlap: Math.max(0, Math.min(b.bottom, field.bottom) - Math.max(b.top, field.top)),
      hits: [b.top + 1, b.top + b.height / 2].map(y => button.contains(document.elementFromPoint(b.left + b.width / 2, y))),
    };
  });
  const tab = await geometry();
  console.log('mobile Tab geometry', tab);
  await page.screenshot({ path: testInfo.outputPath('mobile-tab.png') });
  expect.soft(tab.height).toBe(44);
  expect.soft(tab.overlap).toBe(0);
  expect.soft(tab.hits).toEqual([true, true]);
  expect.soft(tab.fieldTop).toBeGreaterThanOrEqual(tab.actionBottom);
  expect.soft(tab.fieldBottom).toBeLessThanOrEqual(844);
  // Include native date subfields and the following due-date input, not just the first Tab.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const next = await geometry();
    expect(next.hits).toEqual([true, true]);
    expect(next.overlap).toBe(0);
    expect(next.fieldTop).toBeGreaterThanOrEqual(next.actionBottom);
  }
  // Ordinary scrolling may move the field behind the action, but never above it in paint/hit order.
  await body.evaluate(el => {
    const field = document.activeElement!.getBoundingClientRect();
    const action = el.querySelector('[data-testid="planner-detail-complete"]')!.getBoundingClientRect();
    el.scrollTop += field.top - action.top;
  });
  const scrolled = await geometry();
  expect(scrolled.height).toBe(44);
  expect(scrolled.overlap).toBeGreaterThan(0);
  expect(scrolled.hits).toEqual([true, true]);
  await page.screenshot({ path: testInfo.outputPath('mobile-scroll.png') });
});

test('planner-redesign-c1: backlog and selection are opt-in, not permanent card chrome', async ({ page }) => {
  // Regression: backlog steals a lane and selection competes with completion on every card.
  await openPage(page, '/planner');
  await expect(page.getByTestId('planner-backlog')).not.toBeVisible();
  await expect(page.getByTestId('planner-task-select-task-wed')).not.toBeVisible();
  await page.getByRole('button', { name: 'Select tasks', exact: true }).click();
  await page.getByTestId('planner-task-select-task-wed').click();
  await expect(page.getByTestId('planner-selection-count')).toHaveText('1 selected');
  await expect(page.getByTestId('planner-task-task-wed')).toBeVisible();
  await page.getByTestId('planner-clear-selection').click();
  await page.getByTestId('planner-task-select-task-wed').click();
  await page.getByRole('button', { name: 'Complete selected', exact: true }).click();
  await expect(page.getByTestId('planner-task-task-wed')).toHaveCount(0);
  await page.getByRole('button', { name: /^Backlog \d/ }).click();
  await expect(page.getByTestId('planner-add-backlog-task')).toBeVisible();
  await page.getByTestId('planner-add-backlog-task').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Backlog \d/ })).toBeFocused();
});

test('planner-redesign-c2: readable dense cards keep left completion separate from drag', async ({ page }) => {
  // Regression: 88px right controls squeeze titles, or completion starts a drag/opens details.
  await openPage(page, '/planner');
  const title = page.getByTestId('planner-task-task-wed');
  const completion = page.getByTestId('planner-complete-task-wed');
  const geometry = await title.evaluate(el => {
    const card = el.closest('article')!;
    const button = card.querySelector('[data-testid^="planner-complete-"]')!;
    const t = el.getBoundingClientRect(), c = button.getBoundingClientRect();
    return { height: card.getBoundingClientRect().height, left: c.right <= t.left, width: c.width, hitHeight: c.height, font: getComputedStyle(el.querySelector('strong')!).fontSize, hit: button.contains(document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)), draggable: button.getAttribute('draggable') };
  });
  expect(geometry.height).toBeLessThanOrEqual(94);
  expect(geometry.left).toBe(true);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.hitHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.font).toBe('13px');
  expect(geometry.hit).toBe(true);
  expect(geometry.draggable).not.toBe('true');
  await completion.focus();
  await page.keyboard.press('Space');
  await expect(title).toHaveCount(0);
  await expect(page.getByTestId('planner-inspector')).toHaveCount(0);
  await page.getByTestId('planner-filter-all').click();
  await expect(title).toHaveAttribute('draggable', 'false');
  await expect(page.getByTestId('planner-event-calendar-wed')).toContainText('Calendar · read only');
  await expect(page.getByTestId('planner-complete-calendar-wed')).toHaveCount(0);
});

test('planner-redesign-c3: intermediate week stays horizontal with local overflow', async ({ page }) => {
  // Regression: responsive CSS turns chronological week into two-column masonry.
  await page.setViewportSize({ width: 1100, height: 900 });
  await openPage(page, '/planner');
  const board = page.getByRole('region', { name: 'Weekly plan', exact: true });
  await expect(board).toHaveAttribute('tabindex', '0');
  const tops = await page.locator('.day-lane > header').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
  expect(tops).toHaveLength(7);
  expect(new Set(tops).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('planner-redesign-c4: narrow Agenda Today reaches today without a backlog preamble', async ({ page }) => {
  // Regression: Today is disabled in the current week and leaves Wednesday offscreen.
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, '/planner');
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('planner-today').click();
  await expect(page.locator('#planner-day-title-2026-08-12')).toBeInViewport();
  await expect(page.getByTestId('planner-day-2026-08-12').locator('header')).toContainText('16 open');
  for (let i = 1; i <= 4; i++) await expect(page.getByTestId('planner-day-2026-08-12').locator('article').nth(i - 1)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('planner-backlog')).not.toBeVisible();
});

test('planner-redesign-c5: inspector status-only completion preserves dirty notes and supports reopen', async ({ page }) => {
  // Regression: completing unmounts the editor or submits its unsaved fields.
  await openPage(page, '/planner');
  await page.getByTestId('planner-task-task-wed').click();
  await page.getByTestId('planner-edit-notes').fill('Unsaved redesign note');
  const action = page.getByTestId('planner-detail-complete');
  await expect(action).toHaveText('Complete task');
  await expect(action).toBeInViewport({ ratio: 1 });
  await page.getByTestId('planner-save-task').scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  await action.click();
  await expect(action).toHaveText('Reopen task');
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved redesign note');
  await page.getByTestId('planner-inspector-close').click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved redesign note');
  await action.click();
  await expect(action).toHaveText('Complete task');
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved redesign note');
});

test('planner-redesign-c3 desktop: seven visible headings and seven dense rows, without sacrificing title width', async ({ page }) => {
  // Regression: seven DOM lanes exist but the last days and useful rows are offscreen.
  await openPage(page, '/planner');
  const heads = page.locator('.day-lane > header');
  for (const heading of await heads.all()) await expect(heading).toBeInViewport({ ratio: 1 });
  const tops = await heads.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
  const lane = page.getByTestId('planner-day-2026-08-10');
  const measurements = await lane.locator('article').evaluateAll(nodes => nodes.map(n => ({ height: n.getBoundingClientRect().height, title: n.querySelector('.task-main')!.getBoundingClientRect().width })));
  console.log('Planner density: fifteen Monday card heights', JSON.stringify(measurements));
  expect(measurements).toHaveLength(15);
  expect(Math.max(...measurements.map(m => m.height))).toBeLessThanOrEqual(94);
  expect(Math.min(...measurements.map(m => m.title))).toBeGreaterThanOrEqual(120);
  for (let i = 0; i < 7; i++) await expect(lane.locator('article').nth(i)).toBeInViewport({ ratio: 1 });
});

test('planner-redesign-c6: keyboard Move task uses date placement without changing manual deadline', async ({ page }) => {
  // Regression: keyboard users cannot schedule, or manual placement overwrites the hard deadline.
  await openPage(page, '/planner');
  await page.getByTestId('planner-task-task-wed').click();
  const due = await page.getByTestId('planner-edit-due-date').inputValue();
  await page.getByText('Move task', { exact: true }).click();
  await page.getByLabel('Move to date').fill('2026-08-14');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('planner-edit-due-date')).toHaveValue(due);
  await page.getByTestId('planner-inspector-close').click();
  await expect(page.getByTestId('planner-day-2026-08-14').getByTestId('planner-task-task-wed')).toBeVisible();
});

test('planner-redesign-c6 fixture: inspector earlier/later persists canonical order with unavailable edge reasons', async ({ page }) => {
  // Regression: removing card arrows silently removes keyboard ordering from the fixture representation.
  await openPage(page, '/planner');
  const lane = page.getByTestId('planner-day-2026-08-12');
  const before = await lane.locator('[data-task-title]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')));
  await page.getByTestId('planner-task-task-wed').click();
  await page.getByText('Move task', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move Prepare Sunday service handoff earlier', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Prepare Sunday service handoff later', exact: true }).click();
  await page.getByTestId('planner-inspector-close').click();
  const after = await lane.locator('[data-task-title]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')));
  expect(after[0]).toBe(before[1]);
  expect(after.indexOf('planner-task-task-wed')).toBeGreaterThan(0);
  expect([...after].sort()).toEqual([...before].sort());
});
