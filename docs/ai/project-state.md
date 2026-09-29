# Rhythm — Project State

## Side track (2026-09-29): local decision engine

- **Branch:** `feat/local-decision-engine`.
- **What it adds:** reranker-based model routing, MCP tool ranking and memory ranking. The model is Qwen3-Reranker on llama.cpp over loopback. All three features default to `off`.
- **Status:** PR open for review.
- **Next:** run the bench against a real model on the Mac, then set the flags to `shadow`. See [run](runs/2026-09-29-local-decision-engine.md) and [setup](decision-engine-setup.md).
- **Unaffected:** the mega PR #1544 state below.

## Focus

Complete the unfinished Rhythm scope in draft mega PR #1544: Bot Crossing inside Rhythm, shared memory, shared canonical agents/settings, native Hermes execution, and two-way delegation. AJ chose Hermes itself to run shared agents launched there. One final combined smoke; no merge, deployment or release.

## Pause checkpoint

AJ requested a pause after active agent turns finish. No new slices or combined smoke should begin until resumed. Accepted source remains at the heads below; helper-probe and Colony receiver candidates are preserved separately, awaiting parent review. The read-only #1540 plan is saved in the repair4 evidence folder. #1553 has a clean prepared worktree only; implementation has not started. See [pause handoff](runs/2026-09-24-orchestration-pause.md).

## Current branches

Rhythm integration: `mega/2026-09-18-mobile-electron-hermes`, [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544), HEAD `21f26099` (2026-09-28). Local signed candidate: `/private/tmp/rhythm-mega-mobile-build13/apps/electron/dist/Rhythm.app` (worktree kept until smoke; `.mega-wt/integration` no longer exists).

Hermes clean integration: `/private/tmp/hermes-shared-integration`, `db0cba2d3c`, companion draft PR17. Bot Crossing: `/private/tmp/bot-crossing-colony-artifact`, `a30b4c9`, companion draft PR5. Neither latest companion source is yet pinned into the Rhythm artifact.

## 2026-09-28 candidate unblock (see [run](runs/2026-09-28-electron-candidate-runtime-start.md))

- Local candidates must be Developer ID signed: `package:mac` then `RHYTHM_SIGN_ONLY=1 … npm run sign:mac`; ad-hoc builds cannot start the runtime and reset macOS privacy grants for other `com.rhythm.desktop` builds.
- Relay outbox: one pending entry per record, live row at send, batched backpressured drain, data: URLs >64 KB stripped, rows capped at 16 MB (#1583).
- Attachments are media artifacts, not inline parts_json (backfill done on AJ's Electron DB: 874 msgs, 1,053 MB). Engine tool-image resize fixed (photon via require(); Bun splitting bug). Mobile + Electron composers downscale uploads to 2048 px.
- Fork SDK regenerated; engine contract fingerprint bumped to `75aaa1f1…` — next mobile build and Electron candidate must ship together. CI green at `469f12aa`.
- Open: #1584 Retry/launch-hang and Electron attachment thumbnails in progress; DB VACUUM; manual UI smoke of the candidate.

## Included and active

- Accounts: credential reader, reference grant broker, existing-auth-envelope identity, real main/preload/view wiring `60c30bf9`, and UI `a4e7b506`. The UI distinguishes eligible static keys, native Hermes ownership, OAuth, missing/unknown sources, configured/applied/pending states. Parent UI checks: 24 focused, 8 rendered, web typecheck pass; candidate styled desktop/narrow keyboard/accessibility check passed and screenshots reviewed. Native owned consumption and packaged qualification remain pending.
- Hermes native spawn: review found real hermes:connection startup bypassed the original host broker. Accepted companion source db0cba2d3c preserves native first-run/runtime resolution/ownership and adds clean environment plus owned-attempt receipts. Failed-stop and repeated-dispose repairs pass parent39 focused checks and Electron typecheck. Resolver helper subprocesses separately need clean environments; three RED contracts reproduce ambient-variable leakage. No all-child sanitation claim yet.
- Shared agents: canonical revision-safe editing is integrated `1b13bca1`; native frozen policy foundation `2291990e54` has 140 parent adjacent tests and 9 real gateway/AIAgent fixture cases passing. Full effective-policy mapping, authenticated local capability transport, shared editors, skills/delegation parity and two-way execution remain required. Hermes must execute natively, without an OpenCode fallback.
- Colony: sealed artifact/shared protected state, private protocol, actual scene transport and owned observation worker/preload source are integrated in companion PR5 through `a30b4c9`, including Node/SQLite capability proof. Parent latest 45 focused tests pass; preceding full256/build passed before bounded review repairs. Actual worker reads synthetic stores without mutation or native probes. Rhythm receiver/supervisor/frame contracts are being authored; native tab and final clean pin remain pending.
- Memory: S5 concurrent-write/external-edit safety is integrated. S6 consent-scoped read-only Hermes search is not implemented; native working-memory files remain untouched. #1573 semantic-search diagnosis is documented; no relevance bypass accepted.
- Profile allowed-skills management is locally verified: All, Selected, and No have distinct exact semantics, with managed-skill CRUD complete. Profile/neighbor Playwright is 28 passed/1 live-only skipped; web typecheck/build/dist, API neighbors (65)/build, live c15, cleanup, health, and UI/accessibility review pass. Two repair rounds closed duplicate alerts, stale/double-submit/delete isolation, and keyboard/focus/44px/720px evidence gaps. Manual shipping-product smoke remains deferred by AJ.
- #1572 preserved direct-provider candidate still has an unresolved availability defect and is not integrated. #1540 workspace UI port and #1576 B2 remain unfinished.

## Verification boundaries

Rhythm CI at `60c30bf9`: five checks pass; server-checks fails one #907 multiple-Anthropic-account test (expected two entries, got one). Focused local file passes. Exact full local reproduction hit widespread worker startup/hook/test timeouts: 41 failed files, 46 failed tests, 3 worker errors; it does not establish the same CI defect. Deterministic scheduler instrumentation reproduced the exact CI failure: queued unmock can delete the replacement account mock. Test-only stable-mock/isolation repair is integrated5cf6ddb8: parent22 pass and candidate32 focused/typecheck pass, including the same forced race schedule. No product change or assertion weakening; new-head CI is pending. No additional broad local repeat is scheduled.

Earlier full API after `4893d12b`: 6329 pass, 264 skipped. Earlier resumed 16-stage gate: 15 passing stages and an engine cancellation timeout; exact stage replay passed396, 5 skipped, 1 todo without proving the timeout cause. Prior full Electron aggregates predate latest slices. These historical receipts are not a current all-green claim.

## Remaining scope and evidence

The [91-issue coverage](runs/2026-09-24-open-issue-coverage.md) still records 12 formal closing references, 28 partial, 1 unintegrated candidate, 13 planned and 37 unmapped issues. All remain in the authorized campaign; counts are not completion claims. See [native shared-agent plan](plans/2026-09-24-native-hermes-shared-agents.md).

No real credential store or vault was modified. Physical audio/iOS, Facilities rendering, provider behavior, both architectures, installed package, signing/notarization and release acceptance remain separate. Preserve unrelated dirty September21 documents. Durable evidence: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/`; individual September24 run notes record exact commands and limitations.

The integration worktree remains dirty and diverged from its remote branch; this workflow did not commit, push, merge, or deploy. The broad gateway fixture retains 10 unrelated dynamic-import failures, and GitNexus was unavailable.

Required sandbox teardown completed successfully: sanitized diagnostics are at `/private/tmp/rhythm-profile-skills-sandbox-20260927.evidence.fmX3Gh`, and the sandbox was removed.
