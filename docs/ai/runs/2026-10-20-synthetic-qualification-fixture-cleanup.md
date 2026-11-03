---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: in-progress
tags: [run, Rhythm]
---

## Files

- `tools/testing/run_packaged_ai.mjs` captures creator authority immediately after `--synthetic` fixture creation and removes only that fixture after a zero-status Playwright run and free runtime ports.
- `tools/testing/qualification_fixture_cleanup.mjs` revalidates exact root, manifest, UID, mode, inode, digest, source revision and private fixture bindings. It scans entries without following child links and refuses uncertain ownership or busy ports.
- `tools/testing/qualification_fixture_cleanup.test.mjs` exercises deletion, retention, changed authority, busy port and external link targets on fresh test fixtures.

## Checks

- Pre-change native boundary: `python3 tools/build/guard.py --repo . node tools/testing/run_packaged_ai.mjs --synthetic ...` passed 7/7 in 49.1s, yet its synthetic fixture remained (`/private/tmp/rhythm-ai-fixture-7edz9q`, roughly 400 MB). Evidence: `/private/tmp/rhythm-private-4fda312118-primary-profile-schedule-confirm-20261020.log`. That existing fixture was not touched.
- Test-first RED: `node --test tools/testing/qualification_fixture_cleanup.test.mjs` failed because the cleanup helper was absent.
- Focused GREEN: `node --test tools/testing/qualification_fixture_cleanup.test.mjs tools/testing/qualification_fixture.test.mjs` — 6 passed, 2 optional Hermes cases skipped, 0 failed.
- Native post-change RED: one packaged MCP lifecycle check passed in 1.2 minutes, then immediate cleanup saw port 4001 busy and exited 1; `/private/tmp/rhythm-ai-fixture-1NfXTv` was retained. Evidence: `/private/tmp/rhythm-private-4fda-mcp-lifecycle-recon-20261020.log`. The parent observed the port free immediately afterward, indicating a teardown delay. This retained fixture was not touched.
- Added a bounded 10-second runtime-port drain with 250 ms polling. A real temporary listener released after 80 ms permits cleanup; a listener held past a 120 ms test deadline retains the fixture and fails. Focused GREEN after this repair: 7 passed, 2 optional Hermes cases skipped, 0 failed.
- `node --check` for launcher and cleanup helper and `git diff --check` passed.
- The parent will run an exact native `--synthetic` CLI Confirm after these testing-only edits. No app, API, model or build process was launched here.

## Notes

- A failed, signaled or caller-owned fixture remains. A successful run with ports busy past the 10-second drain or changed fixture authority exits nonzero and retains evidence.
- GitNexus impact returned UNKNOWN because its index is 312 commits behind this worktree and did not resolve `createQualificationFixture`; manual deletion blast radius was reported as HIGH before launcher/helper symbol edits.

## Address-specific native Confirm

The 10-second drain alone did not fix the native cleanup failure: `/private/tmp/rhythm-private-4fda-mcp-cleanup-confirm-20261020.log` reports observer1/1 then cleanup exit1. FixturelCQtHI retained. Root inspected real sockets:127.0.0.1:4001 connect ECONNREFUSED and bind succeeds, while0.0.0.0:4001 bind EADDRINUSE; `netstat` identifies Tailscale listeners at its own IPv4/IPv6 addresses on4001. There was no Rhythm listener. This supersedes the initial shutdown-delay hypothesis.

The guard now connects and binds the exact127.0.0.1 address used by all three private runtime listeners. It retains the bounded drain and fails on real loopback busy/unknown. No Tailscale process or configuration was changed. Native independent Confirm `npm run build:guard -- node tools/testing/run_packaged_ai.mjs --synthetic packaged-ai-000-primary-first-use.spec.ts --grep-invert UNVERIFIED` exits0,1/1 in38.6s, and prints `Removed successful synthetic qualification fixture: /private/tmp/rhythm-ai-fixture-wiUkca`; log `/private/tmp/rhythm-private-4fda-loopback-cleanup-confirm-20261020.log`. Failed1NfXTv/lCQtHI remain. Combined fixture/cleanup unit tests8 passed/2 optional Hermes skips/0 failed; delayed live listener and persistent live listener boundaries both exercised. A nonloopback listener case confirms cleanup leaves that unrelated listener running; it is supplementary behavior coverage, not an isolated reproduction of Tailscale socket flags. No product bits changed.

GitNexus `impact portIsFree --repo Rhythm --direction upstream` UNKNOWN/not indexed; manual HIGH deletion-scope warning reported before edit. Staged detect_changes is required before commit.
