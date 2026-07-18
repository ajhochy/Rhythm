# Project State

## Current focus

**Mega-PR #1042–#1108 (Opencode Utilization epic) — ✅ COMPLETE & GREEN, draft PR open.**
All 5 stages (35 issues) implemented, verified, and merged into
`mega/opencode-utilization-1042-1108`. Draft PR awaiting human manual smoke + merge.
No agent merge.

## Active branch / PR

- Branch: `mega/opencode-utilization-1042-1108` (contains current `origin/main` @ `02c60cae3`).
- 50 commits, 163 files, +17205/−1169 vs main.
- 8 cluster merges: A1, A2, B-api, B-flt-front, B-flt-remainder, Wave C+D, E-flt-1, E-flt-2, Wave F.

## Issues (35 landed)

1042 1043 1044 1045 1046 1047 1048 1049 1050 1051 1052 1057 1058 1059 1060 1061
1062 1063 1064 1065 1066 1069 1070 1071 1072 1073 1074 1075 1079 1084 1088 1093
1094 1099 1108.

**Excluded / deferred:** #1076 (tracking-only), #1068 (fork-SDK-blocked on #1067),
#1096 (Engraph service-manager epic — follow-up PR). #1093 was a no-op (already
shipped by merged PR #1095). #1079's optional "scheduled-but-hidden" hint deferred.

## Test status (final, 2026-07-17)

- api_server: `tsc` clean; `vitest` **3001 passed / 18 pre-existing memory_* fail / 38 skip** — 0 branch-caused.
- desktop_flutter: `flutter analyze --no-fatal-infos` **0 errors**; full suite **961 passed**.
- Live e2e (serial, isolated sandbox, OpenRouter Haiku): **6/6 pass** (#1048, #1057, #1070, #1073, #1088, #1094).
- Reports: `docs/ai/runs/2026-07-17-mega-pr-1042-1108.md`, `…-mega-verify-stage2-live.md`, `…-mega-verify-stage01.md`.

## Risks / known issues

- **#1072 is the only prod-schema change** — additive `org_settings` table + postgres_bootstrap backfill. Flag for manual review before it runs against production Postgres.
- **Live e2e must run serially** (`--no-file-parallelism`) — shared engine, else worktree/session contention.
- **Sandbox provider isolation** — sandbox HOME can't reach keychain Anthropic OAuth; live runs use OpenRouter (`anthropic/claude-haiku-4.5`), env-overridable.
- **18 pre-existing `memory_*` unit failures** — vault-filesystem test pollution, present on main, unrelated to this PR.

## Next step

Human: manual smoke per `docs/testing/manual-smoke.md`, then merge the draft PR to `main` and cut a release. No agent merge.
