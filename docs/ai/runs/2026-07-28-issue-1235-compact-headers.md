---
date: 2026-07-28
repo: Rhythm
branch: issue/1235-compact-headers
pr: null
issues: [1235]
status: authored-unverified
tags: [run, Rhythm]
---

# Issue #1235 compact mobile headers

## Files

- Consolidated chat navigation, status, Files Changed, and secondary actions in
  `apps/mobile/components/chat/chat-header.tsx`.
- Removed the persistent chat selector/action row without changing the
  keyboard/composer subtree.
- Suppressed native duplicate headers on chat and Tool detail routes.
- Tightened the Agents tab title header and added stable UI-test identifiers.
- Added contract, Playwright, acceptance mapping, and caller-impact evidence.

## Checks

- `node --test tests/issue-1181-1182-dynamic-type.test.mjs
  tests/contract/issue-1235-compact-headers.test.mjs` — pass, 9/9.
- Focused Playwright rerun of the nine previously failing scenarios — could
  not start because this sandbox rejected the fake-server bind to
  `127.0.0.1:44096` with `listen EPERM`; no browser tests executed.
- `git diff --check` — pass.
- Third-round label verification: React Native Web
  `renderToStaticMarkup` emitted exactly one `aria-label` for the replacement
  focusable Pressable used by Chat actions and Show activity.

## Notes

- Physical-device review remains required at default/largest Dynamic Type,
  portrait/landscape, and with the keyboard visible.
- Changes are intentionally uncommitted because the git index is locked by the
  orchestrator.
