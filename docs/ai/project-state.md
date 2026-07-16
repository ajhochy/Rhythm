# Project State

## Current focus

Open-PR merge train complete. All previously-open PRs are merged into `main`;
zero open PRs remain.

## Active branch / PR

- Branch: `main` at `4259320f5` (post-merge).
- No open PRs.

## In progress

- Nothing. The 9-PR backlog from the 2026-07-16 Codex handoff is fully landed.

## Recently merged (2026-07-16)

- #1104 (#1038 dark-theme Projects) and #1106 (#1082 skill-revert byte-safe) — merged by the prior Codex session.
- #1100 (#1091 gemini anyOf sole-key), #1101 (#1089 cron timezone), #1102 (#1083 NULL MCP scope insert-only),
  #1103 (codex gpt-5.6-sol route), #1095 (#1093 hybrid Engraph memory retrieval),
  #1105 (#1001 live-E2E isolation guard), #1107 (#1041 prompt-fix resolver fallback) — this session.
- Each remaining PR was rebuilt as a single clean commit on current `main`, dropping the shared
  pre-squash #1097 noise that would otherwise have reverted `project-state.md` and re-added divergent
  manager-routing files on squash-merge.

## Risks / known issues

- #1100's fix lives in `apps/opencode_fork` (no fork CI in this repo). Source fix is unit-tested
  (bun test 12/12); the shipping app uses a pre-built fork binary, so a release build must rebuild
  the fork to pick it up.
- Codex's speculative hardening (allowed_mcps_state provenance column, path confinement) was
  deliberately NOT adopted — Codex itself flagged it HIGH blast radius; the PRs' own targeted fixes
  are sufficient and covered by tests.

## Test status

- Final merged `main`: `npm run build` clean, full unit suite 2769 passed / 32 skipped, 0 failures
  (baseline was 2728; +41 from the merged PRs' tests).
- Release smoke (`apps/api_server/scripts/smoke-launch.sh`) on merged `main`: PASS — build + spawn +
  bind :4001 + /health + /agents/capabilities 200 + POST /agent-sessions 201, isolated temp DB.
- All 6 api_server PRs passed `server-checks` CI on their pushed SHAs; #1100 validated locally (no fork CI).

## Next step

Trigger a desktop release build (increment patch from latest tag) when ready to ship; the release
build rebuilds the bundled Node server and the opencode fork binary (needed for #1100 to take effect).
