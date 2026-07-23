# Project State

## Current focus

**Mega-PR #1042–#1108 (Opencode Utilization epic) — ✅ SHIPPED.** PR #1122 merged to
`main` 2026-07-18 (merge commit `606d3303`) after human-confirmed manual UI smoke
(see `docs/ai/runs/2026-07-17-mega-pr-1122-manual-ui-smoke.md`). All 35 issues landed.
Follow-up bug filed from smoke testing: [#1124](https://github.com/ajhochy/Rhythm/issues/1124)
(`ApiServerService` orphan-detection can kill a dev sandbox server and respawn
against production paths — unrelated to this PR, needs its own fix).

## Merged PR

- PR #1122, `mega/opencode-utilization-1042-1108` → `main`, merged 2026-07-18.
- 50 commits, 163 files, +17205/−1169 vs prior main.
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

PR #1122 merged to `main`. Remaining: cut a release (`workflow_dispatch` on
`desktop_release.yml`, next patch tag) whenever the user wants to ship it — not
triggered yet. Separately, [#1124](https://github.com/ajhochy/Rhythm/issues/1124)
(orphan-detection bug) needs its own fix/PR.
