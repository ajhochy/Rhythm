import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openFixture } from '../helpers';

// Issue #1552: the delegated-task ("child session") card wraps its title one word
// per line. Root cause has two independent defects in apps/web/src/styles.css:
//   1. `.child-chip` declares THREE tracks (`8px minmax(0, 1fr) 14px`) for a button
//      that renders only TWO children (`<span>` + chevron `<svg>`), so the title span
//      lands in the 8px track and wraps at 8px; the chevron lands in the 1fr track and
//      floats mid-card instead of at the right edge.
//   2. `.child-chip > span:nth-child(2)` targets the chevron (second child), never the
//      content span (first child), so the span is not a grid container and `<strong>`
//      (title) and `<small>` (meta) stay inline and run together ("regressionrunning").
// These fixtures render the REAL app (fixture mode, no live backend) so the real
// styles.css and real Transcript.tsx markup are measured, not a hand-injected stub.
// The chip is produced by seed block b-children in src/fixtures.ts:
// `open-child-session-coverage-child` (title "Volunteer coverage audit",
// meta "working · 1m 42s") in the default fixture session (session-sunday-handoff).

const viewports = [1440, 1024, 780];
// The .child-chip button itself carries the open-child testid from seed block b-children,
// so the testid element IS the chip (the testid is on the button, not a descendant).
const childChip = (page: import('@playwright/test').Page) =>
  page.getByTestId('open-child-session-coverage-child');

type Geo = {
  chip: { width: number; right: number; centerY: number };
  trackCount: number;
  tracks: string;
  firstChildWidth: number;
  spanDisplay: string;
  strongTop: number;
  smallTop: number;
  chevronRight: number;
  chevronCenterY: number;
  titleText: string;
  metaText: string;
};

async function measure(page: import('@playwright/test').Page): Promise<Geo> {
  const target = childChip(page);
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
    const children = Array.from(el.children);
    const span = el.querySelector('span') as HTMLElement | null;
    const strong = el.querySelector('strong') as HTMLElement | null;
    const small = el.querySelector('small') as HTMLElement | null;
    const chevron = children[1] as HTMLElement | null; // second child: the chevron <svg>
    const spanStyle = span ? window.getComputedStyle(span) : null;
    return {
     chip: { width: rect.width, right: rect.right, centerY: rect.top + rect.height / 2 },
     trackCount: tracks.length,
     tracks: style.gridTemplateColumns,
     firstChildWidth: span?.getBoundingClientRect().width ?? 0,
     spanDisplay: spanStyle?.display ?? '',
     strongTop: strong?.getBoundingClientRect().top ?? NaN,
     smallTop: small?.getBoundingClientRect().top ?? NaN,
     chevronRight: chevron?.getBoundingClientRect().right ?? NaN,
     chevronCenterY: chevron ? chevron.getBoundingClientRect().top + chevron.getBoundingClientRect().height / 2 : NaN,
     titleText: strong?.textContent ?? '',
     metaText: small?.textContent ?? '',
     };
  });
}

test('issue-1552-c1: two-track grid for two children (root cause: 3-track/8px and nth-child(2) removed)', async () => {
  // Regression caught: `.child-chip` keeps a 3-track template (8px | 1fr | 14px) sized
  // for a leading 8px element that the markup never renders, or the span rule keeps
  // targeting nth-child(2) (the chevron). Either defect keeps the title cramped.
  const css = await readFile(path.resolve(import.meta.dirname, '../../src/styles.css'), 'utf8');
  const chipRule = css.match(/\.child-chip\s*\{[^}]*\}/)?.[0] ?? '';
  const spanRule = css.match(/\.child-chip\s*>\s*span[^{]*\{[^}]*\}/)?.[0] ?? '';
   // Two tracks, no 8px placeholder — the leading 8px element was never in the markup.
   // Match the columns *declaration value* only (a whole-rule scan would false-match
  // `min-height: 48px`); token-boundary so `14px`/`1fr`/`48px` do not register as 8px.
  const columns = chipRule.match(/grid-template-columns:\s*([^;]+)/)?.[1] ?? '';
  expect(columns, `columns value: ${columns}`).toMatch(/\bminmax\(0,\s*1fr\)\s+14px\b/);
  expect(columns, `no 8px track`).not.toMatch(/\b8px\b/);
   // The content span is the first child; the rule must not target the chevron (nth-child(2)).
  expect(spanRule).not.toMatch(/:nth-child\(2\)/);
  expect(spanRule).toMatch(/display:\s*grid/);
});

test('issue-1552-c2: title and meta render on separate rows (no run-together) at 1440/1024/780', async ({ page }) => {
    // Regression caught: with the span rule targeting nth-child(2) (the chevron), the
   // content span never gets display:grid, so <strong> title and <small> meta stay inline
   // and run together ("…regressionrunning"). The fix makes the content span a grid
   // container that stacks the title above the meta on its own row.
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page, '#/agents');
    const geo = await measure(page);
    expect(geo.titleText, `title text @${width}`).toBeTruthy();
    expect(geo.metaText, `meta text @${width}`).toBeTruthy();
     // The content span must BE the grid container — false while nth-child(2) targets the chevron.
    expect(geo.spanDisplay, `span display @${width}`).toBe('grid');
     // Title and meta occupy separate rows: meta renders below the title, not beside it.
    expect(geo.smallTop, `meta top @${width}`).toBeGreaterThan(geo.strongTop + 2);
     }
});

test('issue-1552-c3: child chip holds a meaningful card width at 1440/1024/780', async ({ page }) => {
   // Regression caught: the title span is parked in an 8px first track, so it wraps one
  // word per line even though the card is hundreds of pixels wide.
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page, '#/agents');
    const geo = await measure(page);
     expect(geo.chip.width, `chip width @${width}`).toBeGreaterThan(200);
     expect(geo.firstChildWidth, `title container width @${width}`).toBeGreaterThan(80);
    }
});

test('issue-1552-c4: chevron sits flush right and vertically centered', async ({ page }) => {
   // Regression caught: the chevron lands in the 1fr track and floats in the middle of
  // the card instead of at the right edge.
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page, '#/agents');
    const geo = await measure(page);
    // Flush right: chevron right edge within the card's right padding (10px) of chip right.
    expect(Math.abs(geo.chevronRight - geo.chip.right), `chevron flush right @${width}`).toBeLessThan(12);
     // Vertically centered against the (now short, single-line) title, not the tall wrap.
     expect(Math.abs(geo.chevronCenterY - geo.chip.centerY), `chevron centered @${width}`).toBeLessThan(4);
    }
});

test('issue-1552-c5: rendered-width regression locks two tracks for two children', async ({ page }) => {
     // Regression caught: the grid regresses to three tracks (3-track/8px) for a two-child
    // button, re-collapsing the title into the 8px placeholder. This is the rendered-width
   // guard: at every viewport the computed grid has exactly two tracks and the first
   // (title) track is the wide flexible column, not the 8px placeholder.
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page, '#/agents');
    const geo = await measure(page);
    expect(geo.trackCount, `track count @${width}`).toBe(2);
      // First computed track is the title column (wide), not the 8px placeholder.
    expect(geo.firstChildWidth, `title track width @${width}`).toBeGreaterThan(80);
    expect(geo.chip.width, `chip width @${width}`).toBeGreaterThan(200);
       }
   // Electron-renderer evidence: a rendered screenshot of the corrected chip (real layout,
    // headless Chromium == the renderer that measures the Electron webContents).
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFixture(page, '#/agents');
  await childChip(page).scrollIntoViewIfNeeded();
  const shot = process.env.RHYTHM_CAPTURE_EVIDENCE === '1'
     ? path.resolve(import.meta.dirname, '../../../../docs/ai/runs/artifacts/issue-1552/evidence/child-chip-1440.png')
     : path.resolve('test-results/issue-1552-child-chip-1440.png');
  await childChip(page).screenshot({ path: shot });
});
