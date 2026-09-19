import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSessions } from '../src/fixtures';
import { openFixture, openPage } from './helpers';

type Theme = 'dark' | 'light';
const taskId = 'task-archive-runbook';
const richCopy = '# Service handoff\n\nFirst intentional paragraph.\n\nSecond intentional paragraph with **confirmed owners** and [reference](https://example.com/handoff).\n\n## Coverage\n\n| Person | Responsibility |\n| --- | --- |\n| Morgan | Livestream fallback |\n\n```text\n' + 'long-code-token-'.repeat(30) + '\n```';

async function setTheme(page: Page, theme: Theme) {
  await page.addInitScript(value => localStorage.setItem('rhythm-agents-theme', value), theme);
}

async function openTasks(page: Page, theme: Theme) {
  await setTheme(page, theme);
  await openPage(page, 'tasks');
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function openChat(page: Page, theme: Theme, rich = false) {
  await setTheme(page, theme);
  if (rich) {
    const sessions = structuredClone(seedSessions);
    const assistant = sessions[0].messages.find(message => message.id === 'msg-assistant-handoff')!;
    assistant.blocks.find(block => block.id === 'b-markdown')!.content = richCopy;
    await page.addInitScript(value => localStorage.setItem('rhythm-agents-fixture-sessions', JSON.stringify(value)), sessions);
  }
  await openFixture(page);
  await expect(page.getByTestId('message-msg-assistant-handoff')).toBeAttached();
}

// Canvas resolves CSS Color 4 (oklch/color-mix included) to sRGB. Composite every
// ancestor's real background, rather than comparing token strings to --bg.
async function contrast(locator: Locator, pseudo: string | null = null, property: 'color' | 'borderTopColor' | 'outlineColor' = 'color') {
  return locator.evaluate((element, options) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (fg: number[], bg: number[]) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const path: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) path.unshift(node);
    let background = [255, 255, 255];
    for (const node of path) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' || Number(style.opacity) !== 1) throw new Error('Extend contrast helper for images or group opacity');
      background = over(rgba(style.backgroundColor), background);
    }
    const style = getComputedStyle(element, options.pseudo);
    if (options.pseudo) background = over(rgba(style.backgroundColor), background);
    const foreground = over(rgba(style[options.property]), background);
    const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), foreground, background };
  }, { pseudo, property });
}

async function expectContrast(locator: Locator, minimum = 4.5, pseudo: string | null = null, property: 'color' | 'borderTopColor' | 'outlineColor' = 'color') {
  const result = await contrast(locator, pseudo, property);
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(minimum);
}

async function expectHitArea(locator: Locator) {
  const size = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  });
  expect(size.width).toBeGreaterThanOrEqual(44);
  expect(size.height).toBeGreaterThanOrEqual(44);
}

async function expectNoOverflow(locator: Locator) {
  const size = await locator.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

async function renderedFonts(page: Page, selector: string) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    return await client.send('CSS.getPlatformFontsForNode', { nodeId });
  } finally {
    await client.detach();
  }
}

async function expectReadingMeasure(page: Page) {
  const measure = await page.getByTestId('transcript').evaluate(element => {
    const markdown = element.querySelector('.markdown-copy')!;
    const style = getComputedStyle(markdown);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      transcript: element.getBoundingClientRect().width,
      available: element.parentElement!.clientWidth,
      markdownMax: parseFloat(style.maxWidth),
      seventyTwoCh: ctx.measureText('0').width * 72,
      whitespace: style.whiteSpace,
    };
  });
  // Baseline read before edits: .transcript width:min(100%, 840px),
  // .markdown-copy max-width:72ch; these are intentionally not expanded.
  expect(measure.transcript).toBeCloseTo(Math.min(measure.available, 840), 0);
  expect(Math.abs(measure.markdownMax - measure.seventyTwoCh)).toBeLessThan(1);
  expect(measure.whitespace).toBe('pre-wrap');
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: task typography, contrast and distinct interaction states`, async ({ page }) => {
    await openTasks(page, theme);
    const row = page.getByTestId(`task-row-${taskId}`);
    const title = row.getByTestId('task-title');
    const meta = row.locator('.task-meta');
    const completion = page.getByTestId(`task-complete-${taskId}`);
    const typography = await title.evaluate(element => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, weight: Number(style.fontWeight), leading: style.lineHeight };
    });
    expect(typography.size).toBe('14px');
    expect(typography.weight).toBeGreaterThanOrEqual(400);
    expect(typography.weight).toBeLessThanOrEqual(450);
    expect(typography.leading).toBe('20px');
    expect(await meta.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(11);
    await expect(meta).toContainText('Waiting for reply');
    await expect(meta).toContainText('P2');
    await expectHitArea(completion);
    await expectHitArea(page.getByTestId(`task-menu-${taskId}`));
    const backgrounds: string[] = [];
    for (const state of ['default', 'hover', 'selected']) {
      if (state === 'hover') await row.hover();
      if (state === 'selected') await page.getByTestId(`task-select-${taskId}`).click();
      await expectContrast(title);
      await expectContrast(meta);
      await expectContrast(row.locator('.task-tags > span').first());
      await expectContrast(completion, 3, '::before', 'borderTopColor');
      backgrounds.push(await row.evaluate(element => getComputedStyle(element).backgroundColor));
    }
    expect(new Set(backgrounds).size).toBe(3);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await completion.focus();
    await expect(completion).toBeFocused();
    await expect(completion).toHaveCSS('outline-style', 'solid');
    await expect(completion).toHaveCSS('outline-width', '2px');
    await expectContrast(completion, 3, null, 'outlineColor');
    await page.getByTestId('tasks-completion-filter').selectOption('all');
    await completion.press('Space');
    await expect(completion).toBeChecked();
    await expect(title).toHaveCSS('text-decoration-line', 'line-through');
    await expectContrast(title);
    await expectContrast(meta);
    const source = page.getByTestId('task-row-task-calendar-shadow');
    await expect(source.locator('.task-meta')).toContainText('Read only');
    await expect(source.getByRole('checkbox')).toBeDisabled();
    await expect(source.getByRole('checkbox')).toHaveCSS('opacity', '1');
    await expectContrast(source.locator('.task-meta'));
  });

  test(`${theme}: chat body, secondary labels, actions and bounded reading width`, async ({ page }) => {
    await openChat(page, theme);
    const assistant = page.getByTestId('message-msg-assistant-handoff');
    const prose = assistant.locator('.markdown-copy');
    await expect(prose).toHaveCSS('font-size', '14px');
    await expect(prose).toHaveCSS('font-weight', '400');
    const leading = await prose.evaluate(element => {
      const style = getComputedStyle(element);
      return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
    });
    expect(leading).toBeGreaterThanOrEqual(1.5);
    expect(leading).toBeLessThanOrEqual(1.6);
    for (const selector of ['.markdown-copy', 'time', '.message-role', '.cost-line', '.tool-block summary', '.tool-block summary small', '.reasoning-block summary', '.message-actions button']) {
      await expectContrast(assistant.locator(selector).first());
    }
    await expectContrast(page.getByTestId('message-msg-user-handoff').locator('.markdown-copy'));
    const copy = page.getByTestId('copy-msg-assistant-handoff');
    await expectHitArea(copy);
    await copy.hover();
    await expectContrast(copy);
    await copy.focus();
    await expect(copy).toHaveCSS('outline-style', 'solid');
    await expect(copy).toHaveCSS('outline-width', '2px');
    await expectContrast(copy, 3, null, 'outlineColor');
    await expectReadingMeasure(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expectReadingMeasure(page);
  });

  // This test can run unchanged on the baseline commit for like-for-like evidence,
  // independently of the new typography expectations in the tests above.
  test(`${theme}: comparison captures with identical fixtures and pane arrangement`, async ({ page }, testInfo) => {
    await openTasks(page, theme);
    await testInfo.attach(`tasks-${theme}-rendered-fonts`, { body: JSON.stringify(await renderedFonts(page, '.task-row h3')), contentType: 'application/json' });
    await testInfo.attach(`tasks-${theme}-1440x900-100`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.goto('about:blank');
    await openChat(page, theme);
    await page.locator('.transcript-scroll').evaluate(element => { element.scrollTop = 0; });
    await testInfo.attach(`chat-${theme}-rendered-fonts`, { body: JSON.stringify(await renderedFonts(page, '.message.assistant .markdown-copy p')), contentType: 'application/json' });
    await testInfo.attach(`chat-${theme}-1440x900-100`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

for (const layout of [
  { name: 'narrow RTL', width: 390, height: 844, zoom: 1, rtl: true },
  { name: '200% zoom', width: 1440, height: 900, zoom: 2, rtl: false },
]) {
  test(`${layout.name}: long task names wrap and controls stay usable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openTasks(page, 'dark');
    const longTitle = 'Confirm the Sunday service handoff and livestream contingency with every ministry owner — ' + 'LongUnbrokenReference'.repeat(8);
    await page.getByTestId('tasks-header-add-task').click();
    await page.getByTestId('task-create-title').fill(longTitle);
    await page.getByTestId('task-create-submit').click();
    await page.getByTestId('tasks-search').fill(longTitle);
    await page.evaluate(({ zoom, rtl }) => {
      document.documentElement.style.zoom = String(zoom);
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    }, layout);
    const row = page.getByTestId('tasks-list').getByRole('row');
    const title = row.getByTestId('task-title');
    await expect(title).toHaveText(longTitle);
    await expectNoOverflow(title);
    await expectNoOverflow(page.getByTestId('tasks-list'));
    await expectNoOverflow(page.getByTestId('page-tasks'));
    await expectHitArea(row.getByRole('checkbox'));
    await expect(row.getByRole('checkbox')).toHaveAccessibleName(`Complete ${longTitle}`);
    await row.locator('.task-row-main').focus();
    await row.locator('.task-row-main').press('Enter');
    await expect(page.getByTestId('task-edit-title')).toHaveValue(longTitle);
    await page.keyboard.press('Escape');
    await row.getByRole('checkbox').focus();
    await testInfo.attach(`tasks-${layout.name}`, { body: await page.screenshot(), contentType: 'image/png' });
    await row.getByRole('checkbox').press('Space');
    await expect(row).toHaveCount(0);
  });

  test(`${layout.name}: markdown, paragraphs, selection, tool expansion and copy`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openChat(page, 'dark', true);
    await page.evaluate(({ zoom, rtl }) => {
      document.documentElement.style.zoom = String(zoom);
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    }, layout);
    const assistant = page.getByTestId('message-msg-assistant-handoff');
    const prose = assistant.locator('.markdown-copy');
    await expect(prose.locator('p')).toHaveCount(2);
    await expect(prose.locator('p').first()).toHaveText('First intentional paragraph.');
    await expect(prose.getByRole('table')).toContainText('Livestream fallback');
    await expectNoOverflow(prose);
    await expectContrast(prose.getByRole('link'));
    await expectContrast(prose.getByRole('heading', { name: 'Service handoff' }));
    await assistant.locator('.reasoning-block summary').click();
    await expect(assistant.locator('.reasoning-block p')).toBeVisible();
    await assistant.locator('.tool-block summary').first().click();
    await expect(assistant.locator('.tool-block').first().locator('pre')).toBeVisible();
    await prose.getByRole('button', { name: 'Copy code' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('long-code-token-'.repeat(30) + '\n');
    const selected = await prose.locator('p').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    });
    expect(selected).toBe('First intentional paragraph.');
    await page.getByTestId('copy-msg-assistant-handoff').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(richCopy);
    await testInfo.attach(`chat-${layout.name}`, { body: await page.screenshot(), contentType: 'image/png' });
    const axe = await new AxeBuilder({ page }).include('.transcript-scroll').analyze();
    expect(axe.violations.filter(v => ['scrollable-region-focusable', 'nested-interactive', 'aria-prohibited-attr'].includes(v.id))).toEqual([]);
  });
}
