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
