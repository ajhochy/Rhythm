# Project State

## Current focus

Live-artifact automated verification passed, but the human visual smoke **failed**: the tested native surface was a security/integration harness rather than a usable end-to-end shipping-app workflow. Existing backend, security, runtime, Dashboard tab, and same-ID agent-to-human work remains present, but it does not constitute usable completion. See `docs/ai/runs/2026-08-10-retro-live-artifact-workflow-failure.md`.

## Active branch / PR

- Branch: `feat/artifact-viewer`, pushed and tracking its remote, with `origin/main` `8a3561d9` merged.
- Draft PR: [#1338](https://github.com/ajhochy/Rhythm/pull/1338) remains **NOT READY** after failed manual smoke.
- Sharing follow-up: [#1339](https://github.com/ajhochy/Rhythm/issues/1339). Import has no issue and requires AJ approval before filing.

## In progress

- Product scope must be decided for importing existing HTML/Claude artifacts and for #1339 before implementation resumes.
- Existing unrelated follow-ups remain: on-device confirmation of #1327 subagent approvals; #1319 parent taint propagation and `rhythm_delegation_transcript`; transcript fencing for the remaining half of #1331.

## Risks / known issues

- The shipping app has no user-facing import for existing HTML/Claude artifacts, no Share dialog or collaborator management for existing artifacts, and no agent tool to update sharing after creation.
- The CI server check failed and remains separately untriaged; it is not the explanation for the product-smoke failure.
- GitNexus CLI conservatively reports **HIGH** across eight flows; all eight map to tested PCO-read or artifact-create entry points and are covered. Manager MCP reports LOW. The guarded DEBUG-only `MainFlutterWindow` registration retained its pre-impact startup-risk review and is absent from the Release binary.
- Unrelated nonblocking residual: VoiceOver traversal through offscreen dashboard rows.
- #1322 remains partial: plan mode does not make arbitrary `bash` read-only.
- Never start a bare manual `api_server` for smoke; use `tools/dev/sandbox.sh` to avoid the live engine/DB collision paths.
- The rejected demo process remains running by AJ's direction; do not manipulate it.
- `apps/api_server` still has no effective lint gate; TypeScript compilation is its static check.

## Test status

- Automated verification: **PASS** after merging `origin/main`; sanitized `ai-workflow checks --level pr` passed.
- Post-merge totals: API **4,127**, Flutter **1,129** (including **48** live-artifact), and MCP **169**; focused MCP/security **21**, AV-03 contract **11**, and real Postgres bootstrap/parity **2** passed.
- Native AV-06 A1–A10/C3–C5, secure bridge/runtime checks, Release package verification, deterministic screenshots, and the real engine/MCP → hosted API → human same-ID flow passed.
- Human visual smoke: **FAILED**; PR #1338 is not ready.

## Next step

Decide the import product scope and #1339 scope before implementation resumes. Then run an early shipping-app user-journey smoke before further hardening or any PR-readiness claim. Do not merge or deploy PR #1338.

## Recent coding-agent runs

### 2026-08-10 — issue #1270 mobile profile fallback
- Files modified: mobile new-session preference utility, provider/create sheet, and focused contract/widget tests.
- Checks run: MSP-002 contract 9/9 PASS; session configuration widget 4/4 PASS; mobile TypeScript and targeted ESLint PASS.
- Decisions made: preserve Secretary-first selection, otherwise use the first gateway-filtered selectable profile; keep an empty catalog blocked with the product-approved explanation.
- Deviations from spec: none.
- Concerns: none beyond final physical-device smoke owned by the combined mobile workstream.

### 2026-08-10 — issues #1280, #1308, and #1311 mobile transport
- Files modified: mobile attachment ceiling constant/callers; dedicated gateway JSON policy; OpenCode HTTP/SSE proxy error handling; focused gateway/proxy tests.
- Checks run: #1280 composer 6/6 PASS; #1308/#1311 focused API 3/3 PASS; API/mobile TypeScript and targeted mobile ESLint PASS.
- Decisions made: keep the ordinary gateway parser at 1 MB and the proxy default at 512 KB, while granting only attachment-carrying prompt operations 15 MB; pass upstream 4xx bytes/status unchanged, synthesize 502 only for unusable transport/response failures, and 504 for timeouts.
- Deviations from spec: physical-iPhone #1280 verification remains human-gated; socket-based API integration tests cannot bind in this worker sandbox (EPERM), so the orchestrator must run them later.
- Concerns: the existing intrinsic composer fix is present and deterministic tests pass, but only a real UIKit event stream can close #1280.

### 2026-08-10 — issues #1364 and #1366 mobile lifecycle
- Files modified: atomic session opener, provider lifecycle/selectors, paired chat reachability transition, lifecycle-tier tests, and physical-device smoke checklist.
- Checks run: lifecycle/pinning/cache/message Jest 12/12 PASS; atomic open contract 12/12 PASS; mobile TypeScript and targeted ESLint PASS.
- Decisions made: exact lookup is authoritative when it returns normally; only lookup errors retain the legacy catalog fallback. Transcript commit precedes background scoped discovery, whose generation/result is fenced and deduplicated around the current explicit pin.
- Deviations from spec: representative remote-gateway latency and physical device evidence remain human-gated and are listed in `docs/testing/manual-smoke.md`.
- Concerns: native timer suspension, UIKit delivery, and Tailscale behavior cannot be proven in this socket/device-restricted worker.

### 2026-08-10 — issue #1363 reviewed session-binding cleanup
- Files modified: standalone cleanup CLI, focused dry-run/apply/audit tests, CLI dispatch, and human-run manual-smoke protocol.
- Checks run: cleanup plus existing CLI tests 11/11 PASS; API TypeScript and build PASS. The apply command was deliberately not run.
- Decisions made: candidate selection is exact `Theological-Researcher` binding only; every candidate must be explicitly approved or preserved; approved replacement mappings must exist; stale rows abort the transaction; audit output is reserved before mutation.
- Deviations from spec: the actual apply and desktop/mobile relaunch checks remain human-gated by mandate.
- Concerns: the apply command and cross-client relaunch verification remain intentionally human-owned; no automated apply was attempted.
