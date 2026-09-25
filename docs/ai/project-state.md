# Rhythm — Project State

## Focus

Complete the unfinished Rhythm scope in draft mega PR #1544: Bot Crossing inside Rhythm, shared memory, shared canonical agents/settings, native Hermes execution, and two-way delegation. AJ chose Hermes itself to run shared agents launched there. One final combined smoke; no merge, deployment or release.

## Current branches

Rhythm integration: `mega/2026-09-18-mobile-electron-hermes`, `.mega-wt/integration`, [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544), product HEAD `a4e7b506`.

Hermes clean integration: `/private/tmp/hermes-shared-integration`, `db0cba2d3c`, companion draft PR17. Bot Crossing: `/private/tmp/bot-crossing-colony-artifact`, `569cf72`, companion draft PR5. Neither latest companion source is yet pinned into the Rhythm artifact.

## Included and active

- Accounts: credential reader, reference grant broker, existing-auth-envelope identity, real main/preload/view wiring `60c30bf9`, and UI `a4e7b506`. The UI distinguishes eligible static keys, native Hermes ownership, OAuth, missing/unknown sources, configured/applied/pending states. Parent UI checks: 24 focused, 8 rendered, web typecheck pass; candidate styled desktop/narrow keyboard/accessibility check passed and screenshots reviewed. Native owned consumption and packaged qualification remain pending.
- Hermes native spawn: review found real hermes:connection startup bypassed the original host broker. Accepted companion source db0cba2d3c preserves native first-run/runtime resolution/ownership and adds clean environment plus owned-attempt receipts. Failed-stop and repeated-dispose repairs pass parent39 focused checks and Electron typecheck. Resolver helper subprocesses separately need clean environments; three RED contracts reproduce ambient-variable leakage. No all-child sanitation claim yet.
- Shared agents: canonical revision-safe editing is integrated `1b13bca1`; native frozen policy foundation `2291990e54` has 140 parent adjacent tests and 9 real gateway/AIAgent fixture cases passing. Full effective-policy mapping, authenticated local capability transport, shared editors, skills/delegation parity and two-way execution remain required. Hermes must execute natively, without an OpenCode fallback.
- Colony: sealed artifact/shared protected state, private protocol, actual scene transport and owned observation worker/preload source are integrated in companion PR5 through `569cf72`. Parent latest 45 focused tests pass; preceding full256/build passed before bounded review repairs. Actual worker reads synthetic stores without mutation or native probes. Rhythm receiver/supervisor/frame contracts are being authored; native tab and final clean pin remain pending.
- Memory: S5 concurrent-write/external-edit safety is integrated. S6 consent-scoped read-only Hermes search is not implemented; native working-memory files remain untouched. #1573 semantic-search diagnosis is documented; no relevance bypass accepted.
- #1572 preserved direct-provider candidate still has an unresolved availability defect and is not integrated. #1540 workspace UI port and #1576 B2 remain unfinished.

## Verification boundaries

Rhythm CI at `60c30bf9`: five checks pass; server-checks fails one #907 multiple-Anthropic-account test (expected two entries, got one). Focused local file passes. Exact full local reproduction hit widespread worker startup/hook/test timeouts: 41 failed files, 46 failed tests, 3 worker errors; it does not establish the same CI defect. Deterministic scheduler instrumentation reproduced the exact CI failure: queued unmock can delete the replacement account mock. A test-only stable-mock/isolation repair is active; no product change or assertion weakening. No additional broad local repeat is scheduled.

Earlier full API after `4893d12b`: 6329 pass, 264 skipped. Earlier resumed 16-stage gate: 15 passing stages and an engine cancellation timeout; exact stage replay passed396, 5 skipped, 1 todo without proving the timeout cause. Prior full Electron aggregates predate latest slices. These historical receipts are not a current all-green claim.

## Remaining scope and evidence

The [91-issue coverage](runs/2026-09-24-open-issue-coverage.md) still records 12 formal closing references, 28 partial, 1 unintegrated candidate, 13 planned and 37 unmapped issues. All remain in the authorized campaign; counts are not completion claims. See [native shared-agent plan](plans/2026-09-24-native-hermes-shared-agents.md).

No real credential store or vault was modified. Physical audio/iOS, Facilities rendering, provider behavior, both architectures, installed package, signing/notarization and release acceptance remain separate. Preserve unrelated dirty September21 documents. Durable evidence: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/`; individual September24 run notes record exact commands and limitations.
