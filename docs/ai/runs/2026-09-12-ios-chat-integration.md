---
date: 2026-09-12
repo: Rhythm
branch: feature/ios-end-to-end
pr: null
issues: [ios-chat-integration]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS chat integration

## Files

- Ownership: integrated `apps/mobile/`, `docs/ai/contracts/ios-chat-integration.json`, and this run note only.
- Read-only source worktrees: `feature/ios-account-connect` and `design/ios-experience`.
- Backend worktree, root checkout, production, deployment, commits, pushes, and cleanup are out of scope.

## Checks

### Phase 0 red contract

Command (isolated Jest only; no API, engine, simulator, or app runtime started):

```bash
cd apps/mobile
npx jest --runInBand tests/contract/ios-chat-integration.test.ts tests/chat/agent-chat-detail.test.tsx tests/session-message-merge.test.ts
```

Result: expected failure, 5 failed / 9 passed (14 total). Failures prove missing root sign-in gating, route identity wiring, per-session draft concurrency, uncertain prompt reconciliation, and account environment bootstrap integration. Existing terminal route recovery and stale message guards passed.

Initial dependency lookup failed because this clean worktree had no `node_modules`; an ignored symlink to the already-installed read-only account worktree dependencies was added, then the contract produced behavioral assertion failures rather than a harness error.

### Focused green checks

- Contract command: PASS, 14/14; expanded focused route/stale/draft/interrupted-send/prompt set: PASS, 16/16.
- Integrated presentation checkpoint: PASS, 8 Jest suites / 40 tests.
- `node --test tests/contract/ios-account-connect.test.mjs`: PASS, 8/8.
- `node --test tests/contract/ios-mobile-ui-source.test.mjs`: PASS, 5/5.
- `npm run lint`: PASS with 3 unchanged warnings outside this slice; 0 errors.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.

### Full integration checkpoint

- First `npm test -- --runInBand`: 108/110 passed; two cold-offline relaunch tests exposed an E2E store compatibility regression because its injected store predates `restoreWithAccountBootstrap`.
- Repair: the provider uses account bootstrap when supported and preserves the injected-store `restore` fallback.
- Final `npm test -- --runInBand`: PASS, 29 suites / 110 tests.
- GitNexus `detect_changes(scope=all)`: MEDIUM, 70 indexed changed symbols across 28 files, one affected existing process (`Pair → PairedHostError`); no out-of-scope backend process.

### Representative harness re-measure

Same Node contract harness and source/integrated build mode, 10 trials each:

- Account source median: fresh 2.00 ms with exactly 2 cloud requests; restore 0.14 ms with 0 cloud bootstrap requests.
- Integrated median: fresh 2.03 ms with exactly 2 cloud requests; restore 0.18 ms with 0 cloud bootstrap requests.
- This is in-process harness noise and request-count evidence only, **not iOS performance**; no performance improvement is claimed.

### Native prerequisites / artifact handoff

- Xcode 26.5 (`17F42`) available; iOS Simulator runtimes 18.3, 18.6, and 26.5 installed. No simulator was booted.
- Designated local build output for the later manager-owned native build: `apps/mobile/ios/build/Build/Products/Debug-iphonesimulator/Rhythm Agents Dev.app`.
- The path is not populated in this run because generating/building the native project and booting/installing a simulator candidate require the manager verification stage. No native/live artifact claim is made.

## Notes

- Integrated account discovery/grant transport and the approved UI source slice without modifying either source worktree.
- Root index now distinguishes account restoration/sign-in/error, waits only for active account bootstrap discovery, never requires manual pairing on the supported Google flow, and leaves direct deep-link routes untouched.
- Chat session selection/new-chat actions replace the detail route with the same project/session identity; transcript identity receives `currentSessionId`; back pops the existing list stack when available and falls back to Chats.
- Draft text and attachments are keyed by session. Failed/interrupted sends restore only the originating session and merge rather than overwrite newer typing.
- A potentially accepted prompt is reconciled through message/status reads. A subsequent send is blocked or consumed based on reconciliation; no automatic or blind prompt POST retry and no invented stable message ID were added.
- Existing cache-first open, per-session stale fetch tokens, terminal missing/forbidden/timeout recovery, SSE, and polling behavior remain intact. Zero-project UI remains a truthful workspace-selection/empty-chat state; no fake project was introduced.
- Uncovered whole-app criteria: question-choice checked semantics, Reduce Motion voice animation, native focus restoration/keyboard behavior, VoiceOver/contrast review, and tool forms outside the integrated presentation files remain manager smoke targets.
- Approved sanitized fixture paths were unavailable, so no sandbox/API/engine runtime was started. Final Cloudflare/Synology iOS acceptance and the designated test-chat send remain mandatory manager-observed gates.
- No production access, credentials, backend import, deploy, push, commit, root-checkout write, or cleanup occurred.
