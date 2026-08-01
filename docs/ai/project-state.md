# Project State

## Current focus

Issue #1285 mobile sends to exact-owner projectless desktop chats now avoid
context compaction, hide existing internal compaction records, start the API
event bridge before forwarding the prompt, and poll until the asynchronous
assistant turn becomes visible on mobile.

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Current pushed commit: `60b2a1a23a9cfa4560ee5a7d379b4e48c29e1510`; the c16-c20 corrective delta is local pending commit/push.
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Commit and push the c16-c20 corrective delta, then wait for GitHub Actions.
- Launch the already-installed `Rhythm Agents Dev` bundle when the iPhone 13 mini becomes available to Xcode.
- Re-smoke one unique mobile prompt in the same projectless desktop chat and confirm it appears on both clients with one assistant response and no compaction cards.

## Risks / known issues

- The iPhone 13 mini currently reports `unavailable` to `xcrun devicectl`; an iPad with the same device name is paired and available.
- One unchanged OpenCode interruption test hit its 5-second timeout during an intermediate PR run, then passed alone in 1.3 seconds and passed in the final full PR matrix.
- The isolated sandbox's copied default model configuration returned `Requested entity was not found`; the live regression therefore asserts the bridge-owned desktop transcript persistence boundary, while deterministic mobile tests assert delayed assistant refresh.
- Issue #1280 still needs its physical-iPhone multiline composer smoke.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- Contracts c16-c20: PASS.
- Focused API proxy/state/stream tests: PASS, 3 files / 16 tests.
- Focused mobile contract and Jest tests: PASS.
- Mobile TypeScript and API production build: PASS.
- Isolated live API + fork test: PASS, 1 file / 1 test; projectless owner prompt persisted into `agent_session_messages` through the mobile gateway.
- Fresh fork standalone build and binary smoke: PASS.
- `ai-workflow checks --level issue`: PASS.
- Final `ai-workflow checks --level pr`: PASS, including Flutter tests, serial API suite/build, MCP, fork tests, mobile static/contracts/fake-server, and mobile web E2E.
- Live desktop API and engine health on ports 4001/4096: PASS.
- GitNexus unstaged change detection: MEDIUM, 10 indexed files, 14 symbols, 3 expected gateway execution flows.

## Next step

Commit and push the verified delta, wait for CI, then reconnect/unlock the iPhone
13 mini and run the cross-client projectless-send smoke without installing a
second app.
