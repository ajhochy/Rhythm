import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ToolWorkspace.tsx', import.meta.url), 'utf8');
const profilesSource = await readFile(new URL('./Profiles.tsx', import.meta.url), 'utf8');

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

test('task-bucket-a-ui-repair-c1: failed image and video previews reach the icon fallback', () => {
  // Regression caught: invalid URLs leave broken images or blank videos in Gallery cards.
  const preview = source.slice(source.indexOf('function DesignPreview'), source.indexOf('function LiveGalleryTool'));
  assert.match(preview, /useState\(false\)/);
  assert.equal((preview.match(/onError=/g) ?? []).length, 2);
  assert.match(preview, /failed.*<Icon/s);
});

test('task-bucket-a-ui-repair-c2: live list loading status is distinct from genuine empty', () => {
  // Regression caught: pending Skills and Settings requests announce successful empty catalogs.
  const skills = source.slice(source.indexOf('function LiveSkillsTool'), source.indexOf('function LivePlaybooksTool'));
  const settings = source.slice(source.indexOf('function LiveSettingsTool'), source.indexOf('export function ToolWorkspace'));
  for (const section of [skills, settings]) {
    assert.match(section, /const \[loading, setLoading\] = useState\(true\)/);
    assert.match(section, /role="status"/);
    assert.match(section, /!loading.*EmptyState/s);
  }
});

test('task-bucket-a-ui-repair-c3: rejected skill content shows an error instead of Loading', () => {
  // Regression caught: a rejected content request leaves the detail labeled “Loading…” forever.
  const skills = source.slice(source.indexOf('function LiveSkillsTool'), source.indexOf('function LivePlaybooksTool'));
  assert.match(skills, /contentError/);
  assert.match(skills, /Skill content failed to load/);
  assert.match(skills, /contentError.*Loading…/s);
});

test('task-bucket-a-ui-repair-c4: fixture Settings explicitly says it is not connected', () => {
  // Regression caught: the deterministic fixture claims a real local workspace connection.
  const settings = source.slice(source.indexOf('function SettingsTool'), source.indexOf('function LiveSettingsTool'));
  assert.match(settings, /Fixture preview · not connected/);
  assert.doesNotMatch(settings, /Connected · local workspace/);
});

test('task-bucket-a-ui-repair-c5: live Settings uses the profile fallback instead of raw asset paths', () => {
  // Regression caught: Flutter-only icon paths are printed verbatim in the Live Settings avatar.
  const settings = source.slice(source.indexOf('function LiveSettingsTool'), source.indexOf('export function ToolWorkspace'));
  assert.match(settings, /profileAvatarLabel\(profile\)/);
  assert.doesNotMatch(settings, /profile-avatar">\{profile\.icon\}/);
});

test('task-bucket-a-ui-repair-c6: profile initials take a Unicode code point, not a UTF-16 unit', () => {
  // Regression caught: emoji and supplementary characters render as an unpaired surrogate.
  assert.match(profilesSource, /Array\.from\(part\)\[0\]/);
  assert.doesNotMatch(profilesSource, /part\[0\]/);
});
