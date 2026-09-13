---
date: 2026-09-12
repo: Rhythm
branch: design/ios-experience
pr: null
issues: [ios-mobile-ui]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS mobile UI presentation slice

## Files

- Scope is restricted to the manager-assigned `apps/mobile` presentation files, matching component tests, this run note, and `docs/ai/contracts/ios-mobile-ui.json`.
- Implemented native typography/spacing tokens, visible Chats naming and list controls, stable composer actions, transcript render-state memoization, responsive Tools cards, prop-only sign-in states, refresh-failure feedback, settings action clarity/adjustable semantics, and select/modal semantics.
- No package, lock, provider, lib, route-domain, root-shell, deployment, or server files changed in the source slice.

## Acceptance contract

- Contract: `docs/ai/contracts/ios-mobile-ui.json`
- Initial command: `cd apps/mobile && node --test tests/contract/ios-mobile-ui-source.test.mjs`
- Initial result: expected failure, 5 tests; 2 passed and 3 failed.
- Failure evidence: missing native `System` operational font/spacing/type tokens; retained Agents title; fresh object literal in transcript `extraData`.
- Native/live evidence: `not_tested`; the fixture configuration is unavailable and this slice is prohibited from launching app/API servers or using production access.

## Checks

- Source contract PASS, 5/5.
- Lint and typecheck PASS; lint reported 3 pre-existing warnings, 0 errors.
- Dynamic Type PASS, 2/2; composer PASS, 5/5.
- Focused presentation Jest checkpoint PASS, 8 suites / 34 tests.
- `git diff --check` PASS; GitNexus changed-scope report LOW, 28 indexed symbols, 0 affected processes.

## Notes

- Root-shell sign-in and `ChatView` → `ChatContent.currentSessionId` wiring were intentionally left to this integration slice.
- Question-choice checked semantics and Reduce Motion voice animation remain integration/manual requirements because their HIGH-impact symbols were outside the source slice approval.
- Native iOS Simulator, VoiceOver, contrast, keyboard, Reduce Motion runtime behavior, Cloudflare/Synology, and real-chat behavior remain mandatory manager-observed gates.
- Performance timing was not measured; only the fresh transcript `extraData` allocation was replaced with a memoized value. No percentage is claimed.
