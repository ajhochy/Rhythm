import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const inspectorPath = path.resolve(import.meta.dirname, '../../src/components/Inspector.tsx');

async function inspectorSource() {
  return readFile(inspectorPath, 'utf8');
}

test('issue-1408-c1: session changes retain before/after content and render it when expanded', async () => {
  // Regression caught: session rows expand but render nothing because only patch is displayed.
  const source = await inspectorSource();
  expect(source).toMatch(/before:\s*row\.before/);
  expect(source).toMatch(/after:\s*row\.after/);
  expect(source).toMatch(/expanded\[entry\.path\][\s\S]*entry\.before[\s\S]*entry\.after/);
});

test('issue-1410-c1: both file viewers write the selected path before reporting copy success', async () => {
  // Regression caught: either copy button can show success while never touching the clipboard.
  const source = await inspectorSource();
  expect(source).toMatch(/await\s+navigator\.clipboard\.writeText\(path\);[\s\S]*notify\(['"]File path copied['"]\)/);
  expect(source.match(/copyFilePath\([^,]+,\s*notify\)/g)).toHaveLength(2);
});

test('issue-1410-c2: clipboard rejection does not report success', async () => {
  // Regression caught: denied clipboard permission still produces the success toast.
  const source = await inspectorSource();
  expect(source).toMatch(/async function copyFilePath[\s\S]*catch\s*\{[\s\S]*notify\([^)]*(failed|unable)/i);
});

test('issue-1409-c1: live mode labels the fixture-only terminal', async () => {
  // Regression caught: live users cannot distinguish hardcoded terminal output from a real PTY.
  const source = await inspectorSource();
  expect(source).toMatch(/live\s*\?\s*['"]Not yet live['"][\s\S]*live\s*&&\s*<span className="kind-badge">Fixture/);
});

test('issue-1409-c2: live mode never claims the fixture terminal PTY is connected', async () => {
  // Regression caught: the terminal header falsely advertises a connected PTY in live mode.
  const source = await inspectorSource();
  expect(source).toMatch(/live\s*\?\s*['"]Not yet live['"]\s*:\s*`PTY · \$\{pty\.status\}`/);
});
