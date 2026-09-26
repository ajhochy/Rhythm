# Rhythm feature pack: complete milestones M0–M10 and production packaging

Base: `main`

Refs #3
Refs #4
Refs #5
Refs #6
Refs #7
Refs #8
Refs #9
Refs #10
Refs #11
Refs #12
Refs #13
Refs #14

## Summary

This 42+ commit campaign completes the source, contracts, tests, packaging, installer, provenance, and operator guide for the unified Rhythm feature pack. The validated package contains one Desktop ESM bundle and one dashboard registration bundle, excludes a second React runtime, pins hosted Rhythm data to `https://api.vcrcapps.com`, and exposes exactly three bounded native tools.

The local install/doctor gate passed, but no fork issue is auto-closed: every milestone row in the worker report retains a live, rendered, credentialed, ACP, lifecycle, or missing-evidence closure gate.

## Milestones delivered

| Issue | Milestone | Delivered evidence | Remaining closure gate |
| --- | --- | --- | --- |
| #3 | M0 — contracts/runtime safety | Ownership, permission, bounded-operation, renderer-credential, port/proxy, and sibling-root adversarial contracts. | Rerun core plugin reload and ACP suites. |
| #4 | M1 — shared UI | Vendored `@ajhochy/rhythm-workspace-ui` provenance and external-React rebundling. | Supply the missing #4 commit/plan association and shared-package React 18/19 evidence. |
| #5 | M2 — host seams/sidebar | Route/sidebar, disposal, duplicate-free reload, and architecture contracts. | Run Desktop rendered and installed sidebar checks. |
| #6 | M3 — connection | Privacy, PKCE, mounted callback, profile isolation, hosted-origin binding, and explicit legacy-record reconnection. | Verify hosted authentication/provider registration with AJ's credential or approved flow. |
| #7 | M4a — Dashboard/Tasks reads | Sanitized bounded reads, denied broad writes, and mounted read-only/error/draft tests. | Prove installed rendered reads and a nonempty zero-write hosted trace. |
| #8 | M4b — task operations | Identity/profile/payload-bound confirmations, one-use receipts, one PATCH, canonical read-back, conflict, and ambiguous-transport tests. | Run a disposable-task ACP deny/allow-once/read-back gate. |
| #9 | M5 — Planner/Rhythms/Projects | Registry, projections, reauthorization, payload discrimination, read-back, and receipt-concurrency tests. | Prove installed rendered/live parity. |
| #10 | M6 — Messages/Facilities | Pinned reads, denied send/create, exact receipt mutation, authorization, and bulk-delete absence tests. | Prove installed rendered/live parity. |
| #11 | M7 — Automations/Integrations/Artifacts | Classified reads, opaque-origin artifact runtime, and session/conflict-bound capabilities. | Run the installed artifact/renderer isolation check. |
| #12 | M8 — native tools | Exact three-tool discovery, bounded untrusted reads, denied/missing ACP, allow-once scope, stale state, and uncertain-result tests. | Run a real ACP approval client and hosted read-back. |
| #13 | M9 — packaging/lifecycle | Closed-package validation, installer/rollback/tamper/symlink tests, repeated builds, unsigned macOS fixture, hashes, and provenance. | Complete real reload/disable/remove/rollback; signing remains a separate release gate. |
| #14 | M10 — cutover | Destination GET traces, exact tool set, lifecycle, disabled actions, uncertainty, and ledger validation. | Complete current credentialed/rendered cutover; historical ledger labels are not fresh renderer evidence. |

## Gate evidence

- `tests/plugins/rhythm`: 277 tests passed in the worker report.
- Package build produced a validated 30-file tree and archive; both bundle imports, source-map/secret/environment scans, and archive round-trip passed.
- `bash plugins/rhythm/packaging/install-local.sh` exited 0 and preserved config/auth with dated backups.
- `hermes plugins doctor rhythm` passed runtime discovery, manifest parsing, import, and registration: 3 tools, 0 hooks.
- `hermes plugins enable rhythm` succeeded with tool-override grant declined.
- `hermes plugins list` reported `rhythm enabled 0.1.0`; `hermes doctor` exited 0.
- Disable/reload/uninstall remains deferred so the installed package stays available for AJ's live smoke.

## Live gates requiring AJ

1. Fully quit Hermes Desktop, then run the install/enable/reload commands in `plugins/rhythm/packaging/LIVE-GATE.md`; enable **Settings → Plugins → Rhythm**, restart, and verify exactly one sidebar row and `/rhythm` destination with no duplicates after two reloads.
2. Supply a hosted Rhythm token through the hidden backend prompt or an approved browser flow. Explicitly reconnect old unbound records; never copy a credential into renderer state, screenshots, URLs, or logs.
3. Browse Dashboard and Tasks and use **Ask Hermes about this**. Require a bounded editable draft, no send, no agent turn, unchanged task state, GET > 0, zero hosted POST/PATCH/PUT/DELETE, and no call to port 4001.
4. In a real interactive ACP client, deny completion for one disposable task and prove zero write; repeat with **allow once**, require one exact PATCH plus canonical GET read-back, and confirm the UI/native tool agree.
5. Run installed responsive/keyboard/theme/WCAG checks, including 200% zoom and RTL, then complete disable → reload → remove and verify routes, tools, and callbacks disappear without deleting backups or auth records.
6. Provide signing/notarization credentials only if proceeding to an actual signed application release.

## Not included

- No host cutover, OpenCode retirement, renderer-held credentials, arbitrary proxy, blanket ACP approval, or production service takeover.
- No fork issue closure until its remaining row-level gate is recorded.
- No B4 generic dashboard theme-seam claim: `reports/b4-fork.md` is absent from the campaign evidence.
