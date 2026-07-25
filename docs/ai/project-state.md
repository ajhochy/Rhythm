# Project State

## Current focus

Run the cumulative merge-readiness, signed-device, and sandbox gates for open
issues #1076–#1175, then update the existing draft PR.

## Active branch / PR

- Branch: `codex/mobile-1172-agents-activity`
- PR: none yet; this is the isolated mobile integration worktree.

## In progress

- #1076's broad watch list is now superseded by bounded successor issues
  #1176 (v2 lifecycle-parity trigger), #1177 (remote-workspace vertical
  slice), and #1178 (private Rhythm-owned transcript sharing). The tracker has
  the successor links and remains open until this aggregate release is ready.
- Integrated and verified: #1096, #1123, #1132, #1134, #1135, #1137,
  #1157, #1161, #1162, #1164, #1166, #1167, #1168, #1169, #1170, #1171,
  #1172, #1173, and #1174.
- #1171 corrective commit `df75c94cf` independently passes with no P0–P2
  findings: malformed scans recover, Playwright owns dedicated ports, and
  secure-write rollback/recovery remains truthful across restart.
- #1172/#1173 now use the authenticated paired-Mac transport in production:
  safe project catalog, opaque project headers, SSE, PTY headers, activity,
  chat, and cloud/paired tool routing are scoped by account, host, and device.
- #1174 passes independent security review with no actionable findings, mobile
  browser 28/28, API proxy 9/9, iOS Hermes export, and a rebuilt-fork live gate
  that exercised project init/update, a real PTY resize, genuine prompt
  mutation, and model-backed session initialization.

## Risks / known issues

- Compare-to-main impact is expected HIGH/CRITICAL because this branch
  intentionally accumulates the full #1076–#1175 implementation.
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1123 adds one Rhythm MCP tool; the draft PR description must update the
  approximate tool count.
- Signed distribution remains pending after aggregate simulator/live gates.

## Test status

- Required backend slices have focused checks and live sandbox evidence in
  `docs/ai/runs/`; #1096 also has signed Flutter UI evidence.
- #1137's final immutable review passes at `0c8ab294b`, including the guarded
  six-test live endpoint suite.
- #1170 passes focused contracts, API build, non-baseline regressions, and
  rebuilt-fork SSE/PTY live smoke.
- #1171 passes 22 paired-host scenarios, local/CI occupied-port rejection,
  3/3 corrective browser checks, and independent re-review.
- Paired production browser smoke passes QR pairing, project catalog, chat
  creation/completion over SSE, Activity, and an audit proving no filesystem
  paths or credentials crossed the mobile boundary.
- Current aggregate gates pass mobile `test:ci:static`, API build, and 13
  focused mobile gateway/project/SSE tests. GitNexus staged scope for the
  production wiring commit is LOW with zero affected indexed flows.

## Next step

Run cumulative API/mobile/fork/Flutter gates plus signed simulator and physical
device smoke, then push the integration branch and update the existing draft PR
with exact live evidence and production review notes.

## Recent coding-agent runs

- 2026-07-25 — #1175 pairing/tool authorization c18/c19
  (`codex/1175-pairing-tool-auth`): public host-bound one-time-code pairing,
  Device-only replacement/revocation, explicit policy for all ten mobile tool
  mounts, personal owner isolation, verified workspace-admin global mutations,
  and server-derived proposal actors implemented. Focused static/behavioral
  checks and rebuilt-fork isolated live HTTP smoke pass; aggregate-only
  c11/c15/c17/c20/c21/c23 contracts remain with their parallel workstreams.
  See `docs/ai/runs/2026-07-25-1175-pairing-tool-authorization.md`.
- 2026-07-25 — #1175 delegation/Activity hardening
  (`codex/delegation-activity-1175`): locked execution gates, durable
  exactly-once wake reconciliation/restart pagination, per-user Activity
  filtering across all six sources, and Postgres schema parity implemented.
  Focused contracts/build and live Activity/locked-delegation HTTP smokes pass.
  The existing full Gemini wake smoke observed the expected child result,
  deterministic callback, and parent response but timed out on its legacy
  WebSocket idle-frame predicate; see
  `docs/ai/runs/2026-07-25-1175-delegation-activity-hardening.md`.
