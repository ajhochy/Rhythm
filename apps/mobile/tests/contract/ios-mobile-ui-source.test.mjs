import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('task-ios-mobile-ui-c1: operational typography and spacing tokens use the native system scale', async () => {
  // Regression caught: operational controls use a fixed brand font and ad-hoc spacing.
  const theme = await source('../../constants/theme.ts');
  assert.match(theme, /sans:\s*'System'/);
  assert.match(theme, /export const Spacing\s*=\s*\{/);
  assert.match(theme, /export const TypeScale\s*=\s*\{/);
});

test('task-ios-mobile-ui-c2: the retained agents route is visibly named Chats', async () => {
  // Regression caught: users still see Agents as the core journey name.
  const [tabs, screen] = await Promise.all([
    source('../../app/(tabs)/_layout.tsx'),
    source('../../app/(tabs)/agents.tsx'),
  ]);
  assert.match(tabs, /name="agents"[\s\S]*?title:\s*'Chats'/);
  assert.match(screen, />\s*Chats\s*<\/Text>/);
});

test('task-ios-mobile-ui-c3-c9: transcript identity and list render state are stable values', async () => {
  // Regression caught: session changes reuse transcript identity and fresh object extraData rerenders every row.
  const content = await source('../../components/chat/chat-content.tsx');
  assert.match(content, /key=\{currentSessionId \|\| 'no-session'\}/);
  assert.doesNotMatch(content, /extraData=\{\{/);
  assert.match(content, /currentSessionId/);
});

test('task-ios-mobile-ui-c6-c8: owned sheets and state surfaces are scroll-safe and preserve data errors', async () => {
  // Regression caught: fixed portal content clips at large text and refresh errors disappear behind existing data.
  const [sheet, activity, toolState] = await Promise.all([
    source('../../components/chat/session-configuration-sheet.tsx'),
    source('../../components/agents/activity-feed.tsx'),
    source('../../components/tools/tool-screen-state.tsx'),
  ]);
  assert.match(sheet, /ScrollView/);
  assert.match(sheet, /maxHeight/);
  assert.match(activity, /error[\s\S]*items\.length/);
  assert.match(toolState, /accessibilityRole/);
});

test('task-ios-mobile-ui-c10: owned source preserves intrinsic multiline sizing', async () => {
  // Regression caught: redesign restores JS-measured explicit composer height.
  const composer = await source('../../components/chat/chat-composer.tsx');
  assert.match(composer, /multiline/);
  assert.doesNotMatch(composer, /onContentSizeChange/);
});
