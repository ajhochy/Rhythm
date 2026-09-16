/**
 * Guards the web E2E specs against UI label drift.
 *
 * The `foundation` CI job spent 15 minutes failing 91 Playwright assertions
 * after a rename moved the core journey from "Agents" to "Chats" in the app
 * without touching tests/e2e. Every name below is derived from the app source,
 * so a rename fails here in under a second instead of in Playwright.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const specNames = readdirSync(new URL('../e2e', import.meta.url)).filter((name) =>
  name.endsWith('.spec.mjs'),
);
const appSource = async () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name)) files.push(child);
    }
  };
  walk(new URL('../../app/', import.meta.url));
  walk(new URL('../../components/', import.meta.url));
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('');
};

const specs = async () =>
  Promise.all(
    specNames.map(async (name) => [name, await source(`../e2e/${name}`)]),
  );

test('e2e specs target the tab names the app actually renders', async () => {
  const layout = await source('../../app/(tabs)/_layout.tsx');
  const titles = [...layout.matchAll(/title:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.ok(titles.length >= 3, `expected tab titles in _layout.tsx, got ${titles}`);

  for (const [name, spec] of await specs()) {
    for (const match of spec.matchAll(/getByRole\(\s*'tab'\s*,\s*\{\s*name:\s*'([^']+)'/g)) {
      assert.ok(
        titles.includes(match[1]),
        `${name} targets tab '${match[1]}', but the app renders tabs ${JSON.stringify(titles)}`,
      );
    }
    for (const match of spec.matchAll(/getByRole\(\s*'tab'\s*,\s*\{\s*name:\s*\/([^/]+)\//g)) {
      const pattern = new RegExp(match[1]);
      assert.ok(
        titles.some((title) => pattern.test(title)),
        `${name} targets tab /${match[1]}/, which matches none of ${JSON.stringify(titles)}`,
      );
    }
  }
});

test('e2e specs target the menu labels the app actually renders', async () => {
  // Menu affordances are always reached through a static accessibilityLabel,
  // so the rendered set is exactly what the source declares.
  const labels = new Set(
    [...(await appSource()).matchAll(/accessibilityLabel="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  for (const [name, spec] of await specs()) {
    for (const match of spec.matchAll(/'([^']+ menu(?: options)?)'/g)) {
      assert.ok(
        labels.has(match[1]),
        `${name} targets '${match[1]}', which no screen renders any more`,
      );
    }
  }
});

test('e2e specs still reference the rendered chats and Mac connection titles', async () => {
  const [screen, pairedMac] = await Promise.all([
    source('../../app/(tabs)/agents.tsx'),
    source('../../components/settings/paired-mac-section.tsx'),
  ]);
  const headerTitle = screen.match(/accessibilityRole="header"[^>]*>\s*([^<\n]+?)\s*</)?.[1];
  const sectionTitle = pairedMac.match(/variant="titleMedium"[^>]*>\s*([^<\n]+?)\s*</)?.[1];
  assert.ok(headerTitle, 'could not read the chats screen header title');
  assert.ok(sectionTitle, 'could not read the Mac connection section title');

  const all = (await specs()).map(([, spec]) => spec).join('');
  assert.ok(
    all.includes(`'${headerTitle}'`),
    `no e2e spec references the chats screen title '${headerTitle}'`,
  );
  assert.ok(
    all.includes(`'${sectionTitle}'`),
    `no e2e spec references the Mac connection section title '${sectionTitle}'`,
  );
});
