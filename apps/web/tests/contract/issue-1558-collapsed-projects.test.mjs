// Run-detectable mirror of tests/contract/issue-1558-collapsed-projects.spec.ts.
// Runs on plain `node --test` (no node_modules / Playwright needed) so the
// acceptance gate stays observable when the web app's deps are absent. It asserts
// the source-level facts the Playwright contract asserts, under the open-projects
// model (the rail stores the list of OPEN project ids; absent/corrupt => all
// collapsed; the selected group auto-opens). RED against the original `new Set()`
// default; GREEN after SessionRail.tsx implements the feature.
// Each case names the regression it catches.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIL = path.resolve(
   path.dirname(fileURLToPath(import.meta.url)),
   '../../src/components/SessionRail.tsx',
);

function load() {
  return fs.readFileSync(RAIL, 'utf8');
}

function matches(re, label, src) {
  const text = src ?? load();
   assert.ok(re.test(text), `1558: ${label} not found in SessionRail.tsx`);
}

// Return the body of a named `function <name>(...)` so we can assert on its
// internals without assuming specific line breaks or whitespace.
function fnBody(name, src) {
  const text = src ?? load();
  const start = text.indexOf(`function ${name}(`);
   if (start === -1) throw new Error(`1558: ${name}() not found`);
  const end = text.indexOf('\n}', start);
  return end === -1 ? text.slice(start) : text.slice(start, end + 2);
}

test('issue-1558-c1: fresh load defaults all project groups collapsed', () => {
   // Regression: old plain new Set() left every group OPEN on fresh load.
  const src = load();
   assert.ok(
      !/const \[collapsedProjects, setCollapsedProjects\]/.test(src),
      'old collapsedProjects state must be replaced',
   );
  matches(/const OPEN_PROJECTS_STORAGE_KEY = 'rhythm-agents-projects-open'/, 'open key constant defined');
  assert.ok(fnBody('readOpenProjects', src).includes('localStorage.getItem'), 'readOpenProjects reads storage');
});

test("issue-1558-c2: the selected session's group expands", () => {
   // Regression: a collapse-only default hides the selected session.
  matches(/\bid === selected\.projectId/, 'selected group re-derives open via selected.projectId');
   matches(/isOpen\s*=\s*\(id: string\) =>/, 'isOpen predicate auto-opens the selection');
});

test('issue-1558-c3: a toggle survives remount/reload via localStorage', () => {
   // Regression: a manual open was never persisted and reset on reload.
  matches(/localStorage\.getItem\(\s*OPEN_PROJECTS_STORAGE_KEY/, 'reads stored open projects at mount');
  matches(/localStorage\.setItem\(\s*OPEN_PROJECTS_STORAGE_KEY/, 'persists open projects on toggle');
});

test('issue-1558-c4: state is per project id; new projects unaffected', () => {
   // Regression: toggling one group clobbered others or re-opened them all.
  const body = fnBody('readOpenProjects');
  assert.ok(body.includes('value is string'), 'loader keeps only valid per-id strings');
  matches(/const next = new Set\(projectsOpen\);[\s\S]{0,80}if \(isOpen\(id\)\)[\s\S]{0,40}else next\.add/, 'per-id add/delete in toggleProject');
});

test('issue-1558-c5: corrupt or unavailable storage falls back safely', () => {
   // Regression: an unreadable/corrupt key threw at mount or poisoned per-id state.
  const read = fnBody('readOpenProjects');
  assert.ok(read.includes('try {') && read.includes('} catch'), 'readOpenProjects wraps storage in try/catch');
  assert.ok(read.includes('Array.isArray'), 'guards the JSON parse to a real list');
   assert.ok(/catch\s*\{[\s\S]{0,60}return new Set\(/.test(read), 'falls back to empty set on corrupt/unavailable storage');
});

test('issue-1558-c6: chevron and aria-expanded remain in sync', () => {
   // These two lines are unchanged by the feature; GREEN here is genuinely expected.
  matches(/aria-expanded=\{expanded\}/, 'group toggle exposes aria-expanded');
  matches(/name=\{expanded \? 'chevronDown' : 'chevronRight'\}/, 'chevron reflects expanded state');
});
