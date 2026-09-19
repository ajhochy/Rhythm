import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ToolWorkspace.tsx', import.meta.url), 'utf8');
const profilesSource = await readFile(new URL('./Profiles.tsx', import.meta.url), 'utf8');
const agentSettingsSource = await readFile(new URL('./tools/AgentSettingsTool.tsx', import.meta.url), 'utf8');
const inventorySource = await readFile(new URL('../../../../docs/ai/runs/2026-09-18-issue-1513-agent-tools-inventory.md', import.meta.url), 'utf8');

const toolSection = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

const adoptedSections = [
  ['function FixtureBrainTool', 'function LiveBrainTool'],
  ['function LiveBrainTool', 'type ResearchProject'],
  ['function ResearchTool', 'function LiveResearchTool'],
  ['function LiveResearchTool', 'type Schedule'],
  ['function WebhooksTool', 'type ManagedItem'],
  ['function ManagedCatalog', 'function LiveSkillsTool'],
  ['function LiveSkillsTool', 'function LivePlaybooksTool'],
  ['function LivePlaybooksTool', 'type Recipe'],
  ['function CookbookTool', 'function LiveCookbookTool'],
  ['function LiveCookbookTool', 'type Proposal'],
  ['function LiveReviewTool', 'function FixtureReviewTool'],
  ['function FixtureReviewTool', 'function ReportCardTool'],
  ['function ReportCardTool', 'function formatRate'],
  ['function LiveReportCardTool', 'type EmailSignal'],
  ['function EmailTool', '// Live Gallery'],
  ['function LiveGalleryTool', 'type Design'],
  ['function GalleryTool', 'function SettingsTool'],
];

test('issue-1513-c1: inventory names every exposed Agent Tool', () => {
  // Regression caught: a SessionRail entry is omitted from the migration checklist.
  for (const name of ['Brain', 'Deep Research', 'Tasks', 'Webhooks', 'Profiles', 'Skills', 'Playbooks', 'Cookbook', 'Review Queue', 'Report Card', 'Email', 'Gallery', 'Agent Settings']) {
    assert.match(inventorySource, new RegExp(`\\| ${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} \\|`));
  }
});

test('issue-1513-c2: every in-scope Agent Tool adopts the shared ListInspector primitive', () => {
  // Regression caught: one Tool keeps a bespoke card/grid/split implementation instead of the shared selection contract.
  for (const [start, end] of adoptedSections) {
    const section = toolSection(start, end);
    assert.match(section, /<ListInspector\b/, `${start} must render ListInspector`);
    assert.match(section, /inspector=\{/, `${start} must put details and actions in the inspector`);
  }
});

test('issue-1513-c3: adopted tools do not retain page-specific list and split shells', () => {
  // Regression caught: a Tool wraps the primitive in a second bespoke rail/detail implementation.
  for (const [start, end] of adoptedSections) {
    const section = toolSection(start, end);
    assert.equal((section.match(/<ListInspector\b/g) ?? []).length, 1, `${start} must use one shared primitive`);
    assert.doesNotMatch(section, /<aside className="tool-rail"|<div className="proposal-grid"|<div className="design-grid"/, `${start} retains an old page-specific list`);
  }
});

test('issue-1513-c8: every in-scope Agent Tool persists selection with a page-specific URL key', () => {
  // Regression caught: refresh loses selection or an unknown/deleted id silently shows stale first-item details.
  for (const key of ['memoryId', 'researchProjectId', 'webhookId', 'skillId', 'playbookId', 'recipeId', 'proposalId', 'reportAgentId', 'emailId', 'designId']) {
    assert.match(source, new RegExp(`useSelectedId\\([^)]*['\"]${key}['\"]`), `${key} must be persisted with useSelectedId`);
  }
  assert.match(source, /setSelectedId\(deleting\.id\)/, 'fixture deletion must retain the deleted id for the not-found state');
});

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
  assert.match(agentSettingsSource, /function LiveSettingsTool\(/);
  assert.match(agentSettingsSource, /sessions\.profiles\(\)/);
  assert.match(source, /'agent-settings': live \? <LiveSettingsTool Frame=\{ToolFrame\} \/> : <FixtureAgentSettingsTool Frame=\{ToolFrame\} \/>/);
  assert.match(agentSettingsSource, /route: '\/agent-configs'/);
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
  const settings = agentSettingsSource.slice(agentSettingsSource.indexOf('function LiveSettingsTool'));
  for (const section of [skills, settings]) {
    assert.match(section, /const \[loading, setLoading\] = useState\(true\)/);
    if (section.includes('function LiveSkillsTool')) {
      assert.match(section, /loading=\{loading\}/);
      assert.match(section, /error=\{error/);
      assert.match(section, /emptyState=\{<EmptyState/);
    } else {
      assert.match(section, /loading=\{loading\}/);
      assert.match(section, /error=\{error/);
      assert.match(section, /emptyState=/);
    }
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
  const settings = agentSettingsSource.slice(agentSettingsSource.indexOf('function FixtureAgentSettingsTool'), agentSettingsSource.indexOf('function LiveSettingsTool'));
  assert.match(settings, /Fixture preview · not connected/);
  assert.doesNotMatch(settings, /Connected · local workspace/);
});

test('task-bucket-a-ui-repair-c5: live Settings uses the profile fallback instead of raw asset paths', () => {
  // Regression caught: Flutter-only icon paths are printed verbatim in the Live Settings avatar.
  const settings = agentSettingsSource.slice(agentSettingsSource.indexOf('function LiveSettingsTool'));
  assert.match(settings, /profileAvatarLabel\(profile\)/);
  assert.doesNotMatch(settings, /profile-avatar">\{profile\.icon\}/);
});

test('task-bucket-a-ui-repair-c6: profile initials take a Unicode code point, not a UTF-16 unit', () => {
  // Regression caught: emoji and supplementary characters render as an unpaired surrogate.
  assert.match(profilesSource, /Array\.from\(part\)\[0\]/);
  assert.doesNotMatch(profilesSource, /part\[0\]/);
});
