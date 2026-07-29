# Issue #1235 blast-radius analysis

GitNexus impact analysis was waived for this task. The following blast radius
was inferred with repo-wide `rg` searches for each modified component/export
and its imports or route entry points.

## `ChatHeader` — `apps/mobile/components/chat/chat-header.tsx`

- Direct caller: `apps/mobile/components/chat/chat-view.tsx`.
- Screen reached through:
  - `apps/mobile/app/agents/chats/[sessionId].tsx`
  - the chat creation/opening flow under the Agents tab.
- Related tests:
  - `apps/mobile/tests/contract/issue-1238-keyboard-safe-composer.test.mjs`
    locates `<ChatHeader` relative to the keyboard area.
  - `apps/mobile/tests/e2e/issue-1238-keyboard-safe-composer.spec.mjs`
    drives the composing chat screen.
  - New issue #1235 contract and Playwright coverage.
- Inferred risk: medium. Header props and controls change, but the only render
  site was updated in the same change. The keyboard/composer subtree remains
  below the same `KeyboardAvoidingView` boundary and was not edited.

## `ChatView` — `apps/mobile/components/chat/chat-view.tsx`

- Direct caller: `apps/mobile/app/agents/chats/[sessionId].tsx`.
- The route is reached from Agents chat lists and activity deep links.
- Related source: `apps/mobile/components/chat/chat-view-styles.ts`,
  `chat-content.tsx`, and `chat-composer.tsx`.
- Related tests: all mobile chat Playwright flows, especially issue #1238.
- Inferred risk: medium. The persistent tabs row was removed and its actions
  were wired into `ChatHeader`; transcript scrolling and composer keyboard
  behavior were not changed.

## `AgentChatDetailScreen` — `apps/mobile/app/agents/chats/[sessionId].tsx`

- Expo Router route entry; no source import callers.
- Navigation producers found in `apps/mobile/components/agents/activity-feed.tsx`
  and the Agents/chat navigation flow.
- Related tests: issue #1232 deep-link coverage, issue #1238 chat coverage, and
  new issue #1235 coverage.
- Inferred risk: low. `Stack.Screen` only disables the navigator-provided
  duplicate header for loading, error, and ready states.

## `RhythmToolScreen` — `apps/mobile/app/tools/[tool].tsx`

- Expo Router dynamic route entry; no source import callers.
- Routes are produced by `TOOL_SCREEN_MANIFEST`, rendered from
  `apps/mobile/app/(tabs)/tools.tsx`, and used by activity deep links.
- Related tests: `apps/mobile/tests/e2e/rhythm-tools-*.spec.mjs`,
  `issue-1172-tool-deep-links.spec.mjs`,
  `issue-1234-tool-content.spec.mjs`, and new issue #1235 coverage.
- Inferred risk: medium. All early states and the data state now suppress the
  native route header; the existing back and refresh actions remain in the
  single tool app bar.

## `ToolsScreen` — `apps/mobile/app/(tabs)/tools.tsx`

- Expo Router tab route; registered by `apps/mobile/app/(tabs)/_layout.tsx`.
- Navigates to every manifest-backed dynamic Tool screen.
- Related tests: all tool navigation/content Playwright specs and new issue
  #1235 coverage.
- Inferred risk: low. Only a stable test identifier was added to its existing
  single header.

## `AgentsScreen` — `apps/mobile/app/(tabs)/agents.tsx`

- Expo Router tab route; registered by `apps/mobile/app/(tabs)/_layout.tsx`.
- Directly composes `ChatList` and both category/activity variants of
  `ActivityFeed`.
- Related tests: `apps/mobile/tests/e2e/issue-1232-agents-categories.spec.mjs`
  and new issue #1235 coverage.
- Inferred risk: low. The sole title header uses a smaller Dynamic Type-aware
  variant and reduced padding while retaining `SafeAreaView`, the activity
  action, and its accessibility label.

## `ActivityFeed` — `apps/mobile/components/agents/activity-feed.tsx`

- Its only import/render caller is `apps/mobile/app/(tabs)/agents.tsx`, with
  three render sites for activity, scheduled, and background sections.
- Its filtered-empty title was demoted visually from `headlineSmall` to
  `titleMedium` while retaining semantic heading exposure for VoiceOver and
  existing deep-link/category tests. The composed screen still inherits the
  single compact Agents navigation header; this is a subordinate content
  heading, not another app bar.
- Related tests: issue #1232 category/deep-link tests and new issue #1235
  structural coverage.
- Inferred risk: low. Empty-state copy, heading semantics, and filtering
  behavior are unchanged; only its visual level changed to avoid a stacked
  large-title treatment.
