# Project State

## Current focus

Cloud-hosted collaborative live artifacts (AV-01–AV-07) are complete and final verification is **PASS**. The shipped scope includes Synology/Postgres metadata with immutable bytes under `/data/live-artifacts`, private/shared/organization access, five MCP tools (85 → 90), customizable Dashboard tabs, a closed WKWebView bridge (`state.get`, revision-checked `state.update`, and declared `pco.services.read`), and the same-ID Worship Calendar agent-to-human flow. See `docs/ai/contracts/live-artifacts-av07.json` and `docs/ai/runs/2026-08-09-live-artifacts-av07.md`.

## Active branch / PR

- Branch: `feat/artifact-viewer`, pushed and tracking its remote, with `origin/main` `8a3561d9` merged.
- Draft PR: [#1338](https://github.com/ajhochy/Rhythm/pull/1338). No GitHub issue exists for this user-requested feature; the PR body carries the `WAIVED` issue-link line.
- Final evidence includes deterministic Dashboard/native screenshots referenced by the AV-06 final and AV-07 run notes.

## In progress

- No implementation or automated verification remains; human smoke and merge are pending.
- Existing unrelated follow-ups remain: on-device confirmation of #1327 subagent approvals; #1319 parent taint propagation and `rhythm_delegation_transcript`; transcript fencing for the remaining half of #1331.

## Risks / known issues

- No unresolved automated gate remains for live artifacts.
- GitNexus CLI conservatively reports **HIGH** across eight flows; all eight map to tested PCO-read or artifact-create entry points and are covered. Manager MCP reports LOW. The guarded DEBUG-only `MainFlutterWindow` registration retained its pre-impact startup-risk review and is absent from the Release binary.
- Unrelated nonblocking residual: VoiceOver traversal through offscreen dashboard rows.
- #1322 remains partial: plan mode does not make arbitrary `bash` read-only.
- Never start a bare manual `api_server` for smoke; use `tools/dev/sandbox.sh` to avoid the live engine/DB collision paths.
- `apps/api_server` still has no effective lint gate; TypeScript compilation is its static check.

## Test status

- Final verification gate: **PASS** after merging `origin/main`; sanitized `ai-workflow checks --level pr` passed with no unresolved automated gate.
- Post-merge totals: API **4,127**, Flutter **1,129** (including **48** live-artifact), and MCP **169**; focused MCP/security **21**, AV-03 contract **11**, and real Postgres bootstrap/parity **2** passed.
- Native AV-06 A1–A10/C3–C5, secure bridge/runtime checks, Release package verification, deterministic screenshots, and the real engine/MCP → hosted API → human same-ID flow passed.

## Next step

Complete the human manual smoke in `docs/testing/manual-smoke.md`, then a human may merge PR #1338 after smoke approval. Do not deploy or merge automatically.
