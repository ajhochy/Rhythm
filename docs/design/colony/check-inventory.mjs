#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packetRoot = here;
const hudPath = resolve(
  process.argv[2] ??
    process.env.BOT_CROSSING_HUD ??
    '/private/tmp/bot-crossing-colony-artifact/src/ui/hud.js',
);

assert.ok(existsSync(hudPath), `upstream HUD is required: ${hudPath}`);

const hud = readFileSync(hudPath, 'utf8');
const readPacket = (name) => {
  const path = join(packetRoot, name);
  assert.ok(existsSync(path), `missing packet file: ${name}`);
  return readFileSync(path, 'utf8');
};

const collect = (pattern, value = (match) => match[1]) =>
  [...hud.matchAll(pattern)].map(value);

const unique = (values) => [...new Set(values)];
const normalizeShortcut = (value) => {
  const text = value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\$\{IS_MAC[\s\S]*?\}\\\\/g, 'Cmd/Ctrl+\\')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
};

const buttonIds = unique(collect(/id=["'](btn-[^"']+)["']/g));
const selectIds = unique(collect(/<select[^>]+id=["']([^"']+)["']/g));
const shortcuts = unique(
  collect(/<kbd>([\s\S]*?)<\/kbd>/g).map(normalizeShortcut).filter(Boolean),
);

// Regression caught: an upstream HUD action silently disappears during the native redesign.
// The assertion fails for the missing upstream identifier or shortcut.
const inventory = readPacket('action-inventory.md');
for (const id of [...buttonIds, ...selectIds]) {
  assert.match(inventory, new RegExp('\\\\|\\\\s*`' + id + '`\\\\s*\\\\|'), `inventory is missing ${id}`);
}
for (const shortcut of shortcuts) {
  assert.ok(
    inventory.includes(`\`${shortcut}\``),
    `inventory is missing shortcut ${JSON.stringify(shortcut)}`,
  );
}
assert.match(inventory, /New conversation[\s\S]*?(Removed|Deferred)/i);
assert.match(inventory, /Resume in terminal[\s\S]*?(Removed|Deferred)/i);
console.log(
  `PASS 1529:colony-design-packet:1 inventory covers ${buttonIds.length} buttons, ${selectIds.length} selects, and ${shortcuts.length} shortcuts`,
);

const compFiles = [
  'comps/1440x900-dark.html',
  'comps/1440x900-light.html',
  'comps/1024x700-dark.html',
  'comps/1024x700-light.html',
  'comps/800x600-dark.html',
  'comps/800x600-light.html',
  'comps/state-selected.html',
  'comps/state-empty.html',
  'comps/state-error.html',
  'comps/state-no-webgl.html',
  'comps/state-stale.html',
  'comps/state-disabled.html',
];
for (const compFile of compFiles) {
  const comp = readPacket(compFile);
  assert.match(comp, /data-incumbents="[^"]*ListInspector[^"]*Splitter[^"]*Menu[^"]*Icon[^"]*"/);
  assert.match(comp, /data-tokens="[^"]*--bg[^"]*--surface[^"]*--fg[^"]*--accent[^"]*"/);
  const controls = [...comp.matchAll(/<[^>]+data-control(?:=["'][^"']*["'])?[^>]*>/g)];
  assert.ok(controls.length > 0, `${compFile} has no annotated controls`);
  for (const [control] of controls) {
    assert.match(control, /data-annotation="(?:ListInspector|Splitter|Menu|Icon|--[a-z-]+)[^"]*"/);
  }

  // Regression caught: a visual comp normalizes a placeholder or glyph-only control with no
  // accessible name, leaving COL-05 without a name/role/value contract to implement.
  for (const [, element, attributes] of comp.matchAll(/<(input|select)\b([^>]*)>/g)) {
    assert.match(attributes, /aria-(?:label|labelledby)="[^"]+"/, `${compFile} has an unnamed ${element}`);
  }
  for (const [, attributes, contents] of comp.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = contents.replace(/<[^>]+>/g, '').trim();
    if (!text || /^[⌂!◎●·]+$/.test(text)) {
      assert.match(attributes, /aria-(?:label|labelledby)="[^"]+"/, `${compFile} has an unnamed icon button`);
    }
  }
}
console.log(`PASS 1529:colony-design-packet:2 ${compFiles.length} annotated compositions present`);
console.log('PASS 1529:colony-design-packet:5 static controls have accessible names');

// Regression caught: implementation begins while a plan/receiver contradiction is unresolved.
const decision = readPacket('../../ai/decisions/2026-09-25-colony-workspace-design.md');
for (let index = 1; index <= 6; index += 1) {
  const start = decision.indexOf(`## D${index}`);
  const end = index === 6 ? decision.length : decision.indexOf(`## D${index + 1}`);
  assert.ok(start >= 0, `decision record is missing D${index}`);
  const block = decision.slice(start, end < 0 ? decision.length : end);
  for (const heading of ['Context', 'Decision', 'Alternatives', 'Consequences']) {
    assert.ok(block.includes(`### ${heading}`), `D${index} is missing ${heading}`);
  }
}
assert.match(decision, /2026-09-18-electron-colony\.md/);
assert.match(decision, /2026-09-24-colony-native-receiver\.md/);
console.log('PASS 1529:colony-design-packet:3 decisions D1-D6 are resolved and reconciled');

// Regression caught: the visual packet omits keyboard and zoom behavior that cannot be inferred.
const readme = readPacket('README.md');
for (const requirement of [
  'Keyboard order',
  'Escape and focus return',
  'Shortcut conflicts',
  'Pane bounds',
  '200% text zoom',
  'Enable → filter → select → inspect → open',
  'Archive → restore',
]) {
  assert.ok(readme.includes(requirement), `README is missing ${requirement}`);
}
for (const conflict of ['search', 'composer', 'terminal']) {
  assert.match(readme, new RegExp(`Shortcut conflicts[\\s\\S]*?${conflict}`, 'i'));
}
console.log('PASS 1529:colony-design-packet:4 keyboard, focus, conflict, bounds, zoom, and flows specified');
