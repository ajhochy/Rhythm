import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

const chatHeader = read('apps/mobile/components/chat/chat-header.tsx');
const chatView = read('apps/mobile/components/chat/chat-view.tsx');
const chatRoute = read('apps/mobile/app/agents/chats/[sessionId].tsx');
const toolRoute = read('apps/mobile/app/tools/[tool].tsx');
const toolsTab = read('apps/mobile/app/(tabs)/tools.tsx');
const agentsTab = read('apps/mobile/app/(tabs)/agents.tsx');
const activityFeed = read('apps/mobile/components/agents/activity-feed.tsx');

test('issue-1235-c1: every chat and tool surface owns exactly one compact header', () => {
  // Regression caught: Expo Router restores its native route header above an Appbar.
  assert.match(chatRoute, /<Stack\.Screen[\s\S]*?headerShown:\s*false/);
  assert.match(toolRoute, /<Stack\.Screen[\s\S]*?headerShown:\s*false/);
  assert.equal((chatHeader.match(/<Appbar\.Header\b/g) ?? []).length, 1);
  assert.equal((toolRoute.match(/<Appbar\.Header\b/g) ?? []).length, 1);
  assert.equal((toolsTab.match(/<Appbar\.Header\b/g) ?? []).length, 1);
  assert.equal((agentsTab.match(/accessibilityRole="header"/g) ?? []).length, 1);
  assert.equal((activityFeed.match(/<Appbar\.Header\b|variant="headlineSmall"/g) ?? []).length, 0);
});

test('issue-1235-c2: chat header exposes navigation, title, status, and overflow', () => {
  // Regression caught: session usage replaces the concise state and administration menu.
  assert.match(chatHeader, /accessibilityLabel="Back to Agents"/);
  assert.match(chatHeader, /selectedSession\?\.title\s*\|\|\s*'Untitled chat'/);
  assert.match(chatHeader, /statusLabel/);
  assert.match(chatHeader, /accessibilityLabel="Chat menu"/);
});

test('issue-1235-c3: Settings and Manage live in overflow and Files Changed is conditional', () => {
  // Regression caught: a permanent second selector row consumes chat transcript height.
  assert.match(chatHeader, /title="Settings"/);
  assert.match(chatHeader, /title="Manage"/);
  assert.match(chatHeader, /diffCount\s*>\s*0[\s\S]*Files Changed/);
  assert.doesNotMatch(chatView, /<View[^>]*styles\.tabsRow/);
  assert.doesNotMatch(chatView, />\s*Manage\s*<\/Button>/);
});

test('issue-1235-c4: tool identity and actions share the compact tool header', () => {
  // Regression caught: tool identity is rendered in a second content title.
  assert.match(toolRoute, /<Appbar\.Content[\s\S]*title=\{manifest\?\.title\s*\?\?\s*'Tool'\}/);
  assert.match(toolRoute, /accessibilityLabel=\{`Refresh \$\{manifest\.title\}`\}/);
  assert.doesNotMatch(toolRoute, /<Text variant="titleMedium">Approved skills<\/Text>/);
});

test('issue-1235-c5: raw session IDs and breadcrumbs are never prominent titles', () => {
  // Regression caught: dynamic route parameters leak into native navigation titles.
  for (const source of [chatHeader, chatView, chatRoute]) {
    assert.doesNotMatch(source, /title=\{(?:params\.)?sessionId\}|Agents\s*\/\s*Chats|Chats\s*\/\s*\{?sessionId/i);
  }
  assert.match(chatRoute, /headerShown:\s*false/);
});

test('issue-1235-c6: compact controls retain accessibility and safe-area contracts', () => {
  // Regression caught: icon-only controls become unlabeled or the chat loses inset handling.
  assert.match(chatHeader, /accessibilityLabel="Chat menu"/);
  assert.match(chatHeader, /accessibilityLabel="Back to Agents"/);
  assert.match(chatHeader, /accessibilityLabel="Close session usage"/);
  assert.match(toolRoute, /accessibilityLabel="Back to Tools"/);
  assert.match(chatHeader, /insetsTop/);
  assert.match(agentsTab, /SafeAreaView[\s\S]*edges=\{\['top'\]\}/);
});

test('issue-1235-c7: compact headers preserve platform-sized touch targets', () => {
  // Regression caught: visual compression makes icon buttons smaller than 44 points.
  assert.match(chatHeader, /styles\.headerAction/);
  assert.match(read('apps/mobile/components/chat/chat-view-styles.ts'), /headerAction:\s*\{[^}]*minWidth:\s*44[^}]*minHeight:\s*44/s);
  assert.match(agentsTab, /<Pressable[\s\S]*accessibilityLabel="Agents menu"/);
  assert.match(agentsTab, /headerAction:\s*\{[\s\S]*minHeight:\s*44[\s\S]*minWidth:\s*44/);
});
