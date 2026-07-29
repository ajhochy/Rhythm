import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const toolScreenSource = await readFile(
  new URL('../../app/tools/[tool].tsx', import.meta.url),
  'utf8',
);
const stateSource = await readFile(
  new URL('../../components/tools/tool-screen-state.tsx', import.meta.url),
  'utf8',
);
const fakeRoutesSource = await readFile(
  new URL('../fake-opencode/rhythm-tools-routes.mjs', import.meta.url),
  'utf8',
);

test('issue-1234-c1: every tool screen has an explicit non-blank presentation', () => {
  // Regression caught: an empty response leaves only whitespace below the app bar.
  assert.match(
    toolScreenSource,
    /items\.length === 0[\s\S]*?<ToolScreenState[\s\S]*?state="empty"/,
  );
  assert.doesNotMatch(
    toolScreenSource,
    /items\.length === 0[\s\S]{0,180}?Nothing here yet\.<\/Text>/,
  );
});

test('issue-1234-c2: tool state component covers loading empty offline forbidden auth and error', () => {
  // Regression caught: two failure modes collapse into blank or indistinguishable copy.
  const expectedStates = [
    'loading',
    'empty',
    'offline-cache',
    'expired-auth',
    'forbidden',
    'error',
  ];
  for (const state of expectedStates) {
    assert.match(stateSource, new RegExp(`['"]${state.replace('-', '\\-')}['"]`));
  }
  assert.match(stateSource, /accessibilityRole="summary"/);
  assert.match(stateSource, /accessibilityLiveRegion=/);
});

test('issue-1234-c3: fake server can drive representative data and every explicit state', () => {
  // Regression caught: E2E stays green because the fake server can only return happy-path data.
  assert.match(fakeRoutesSource, /__control\/rhythm-tools-state/);
  for (const state of ['data', 'empty', 'offline', 'expired-auth', 'forbidden', 'error']) {
    assert.match(fakeRoutesSource, new RegExp(`['"]${state}['"]`));
  }
  assert.match(
    fakeRoutesSource,
    /responseState === 'data'[\s\S]*?state = createState\(\)/,
    'returning to data mode must restore fixtures mutated by other acceptance specs',
  );
});
