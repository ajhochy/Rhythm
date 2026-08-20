import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ToolWorkspace.tsx', import.meta.url), 'utf8');

test('issue-1415-c1/c2: live Gallery consumes real preview URLs and retains an icon fallback', () => {
  // Regression caught: every artifact card renders only the generic gallery icon.
  assert.match(source, /thumbnailUrl/);
  assert.match(source, /<img|<video/);
  assert.match(source, /design\.artifactType/);
  assert.match(source, /<Icon name=\{design\.artifactType/);
});

test('issue-1413-c1/c2: Skills has a live gateway branch while fixtures identify themselves honestly', () => {
  // Regression caught: Live mode still mounts the two-row fixture and advertises fake telemetry.
  const fixtureCatalog = source.slice(source.indexOf('function ManagedCatalog'), source.indexOf('function LiveSkillsTool'));
  assert.match(source, /function LiveSkillsTool\(\)/);
  assert.match(source, /gateway\.domains\.skills!/);
  assert.match(source, /skills: live \? <LiveSkillsTool \/> : <ManagedCatalog key="skills" kind="skills" \/>/);
  assert.doesNotMatch(fixtureCatalog, /<dt>Post score<\/dt>|<dt>Uses<\/dt>/);
  assert.match(fixtureCatalog, /fixture:\/\/skills/);
});

test('issue-1411-c1: Agent settings loads the real agent-config catalog in Live mode', () => {
  // Regression caught: Live mode always renders two local-only fixture rows.
  assert.match(source, /function LiveSettingsTool\(\)/);
  assert.match(source, /gateway\.domains\.sessions!\.profiles\(\)/);
  assert.match(source, /'agent-settings': live \? <LiveSettingsTool \/> : <SettingsTool \/>/);
  assert.match(source, /route: '\/agent-configs'/);
});
