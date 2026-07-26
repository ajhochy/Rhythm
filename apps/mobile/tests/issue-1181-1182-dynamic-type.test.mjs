import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const agentsSource = await readFile(
  new URL('../app/(tabs)/agents.tsx', import.meta.url),
  'utf8',
);
const toolsSource = await readFile(
  new URL('../app/tools/[tool].tsx', import.meta.url),
  'utf8',
);

test('issue-1182: Agents heading uses content-measured layout at maximum Dynamic Type', () => {
  assert.doesNotMatch(
    agentsSource,
    /<Appbar\.Header\b/,
    'Paper Appbar.Header pins a toolbar height that can overlap enlarged text',
  );
  assert.match(
    agentsSource,
    /<Text\s+accessibilityRole="header"\s+variant="headlineSmall">[\s\S]*?Agents[\s\S]*?<\/Text>/,
    'Agents must keep a semantic, naturally measured heading',
  );
  assert.match(
    agentsSource,
    /header:\s*\{[^}]*paddingHorizontal:[^}]*paddingTop:/,
    'the measured heading needs explicit safe spacing from the segmented control',
  );
});

test('issue-1181: Tool cards measure wrapped titles and subtitles before actions', () => {
  assert.doesNotMatch(
    toolsSource,
    /<Card\.Title\b/,
    'Paper Card.Title pins header height and can hide wrapped webhook actions',
  );
  assert.doesNotMatch(
    toolsSource,
    /<Card\.Actions\b/,
    'Paper Card.Actions pins an action-row height that clips wrapped controls',
  );
  assert.match(
    toolsSource,
    /<Card\.Content\s+style=\{styles\.cardHeader\}>[\s\S]*?variant="titleMedium"[\s\S]*?variant="bodyMedium"[\s\S]*?<\/Card\.Content>/,
    'tool cards must use content-measured title and subtitle text',
  );
  assert.match(
    toolsSource,
    /cardHeader:\s*\{[^}]*gap:[^}]*paddingTop:/,
    'the measured card header must preserve readable title/subtitle spacing',
  );
  assert.match(
    toolsSource,
    /<Card\.Content\s+style=\{styles\.cardActions\}>\{actions\}<\/Card\.Content>/,
    'wrapped actions must contribute their full height to the card and scroll extent',
  );
});
