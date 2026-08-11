---
date: 2026-08-07
repo: Rhythm
branch: fix/zen-free-model-bootstrap
pr: null
issues: []
status: ready_for_verification
tags: [run, api_server]
---

# Zen free-model bootstrap

## Files

- `apps/api_server/src/database/migrations.ts` — Config Doctor Zen bootstrap is gated by the `INSERT OR IGNORE` result after immutable historical v1/v2 repairs; rhythm-setup remains insert-only.
- `apps/api_server/src/services/opencode_client_service.ts` — recognizes the engine's keyless `opencode` provider.
- `apps/api_server/src/server.ts` — projects the fresh `rhythm-setup` profile into the engine alongside config-doctor.
- `tools/dev/sandbox.sh` — accepts an empty SQLite source by disabling copied scheduled tasks only when their table exists.
- `apps/api_server/config_seeds/skills/zen-free-models/SKILL.md` and `~/.config/opencode/skills/zen-free-models/SKILL.md` — byte-identical privacy policy, audit-locked v2 roster entry, and Config Doctor/Rhythm Setup handoff limits.
- `apps/api_server/src/__tests__/zen_free_model_bootstrap*.test.ts` — fresh seed/provider and env-gated live contracts.
- `docs/ai/contracts/zen-free-model-bootstrap.json` — contract results.

## Checks

- Acceptance contract command (before implementation):
  `cd apps/api_server && npx vitest run src/__tests__/zen_free_model_bootstrap.test.ts`
- Result: **failed as expected** — fresh migrations returned `anthropic` instead of
  `opencode` for the two profiles, and `listAuthedProviders()` returned `[]` instead
  of the live keyless `opencode` provider.
- Focused contracts after implementation:
  `npx vitest run src/__tests__/zen_free_model_bootstrap.test.ts src/__tests__/rhythm_setup_seed.test.ts src/__tests__/config_seeds_seeder.test.ts`
  → **13 passed**.
- `node_modules/.bin/tsc --noEmit` and `npm run build` → **passed**.
- Fork build initially failed because `@opentui/solid/preload` was absent; `bun install --frozen-lockfile` restored dependencies, then `bun run build --single` → **passed**.
- Disposable fresh source and EMPTY source HOME:
  `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/fresh.db` and
  `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/empty-source-home`.
  `auth.json` was absent before launch.
- Fresh no-auth sandbox command (exact):
  `HOME="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/empty-source-home" RHYTHM_LIVE_DB_PATH="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/fresh.db" RHYTHM_SANDBOX_DIR="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/sandbox" tools/dev/sandbox.sh up`
  → **Sandbox ready** on API `:4098` and engine `:4097`; launcher health checks `/health` and `/opencode/health` both passed.
- Live contract command:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 DB_PATH="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/sandbox/rhythm.db" npx vitest run src/__tests__/zen_free_model_bootstrap_live_e2e.test.ts`
  → **1 passed**. Fresh profiles resolved to `opencode/deepseek-v4-flash-free`, Config Doctor had `zen-free-models`, and the exact no-auth probe output was `zen-bootstrap-ok`.
- Shutdown evidence:
  `HOME="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/empty-source-home" RHYTHM_SANDBOX_DIR="/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-bootstrap-repair-EGuP8F/sandbox" tools/dev/sandbox.sh down && tools/dev/sandbox.sh status`
  → **Sandbox removed**; API `:4098 listener:` empty, engine `:4097 listener:` empty, and independent `lsof` checks were empty.
- Focused contracts:
  `npx vitest run src/__tests__/zen_free_model_bootstrap.test.ts src/__tests__/rhythm_setup_seed.test.ts src/__tests__/config_seeds_seeder.test.ts`
  → **3 files / 13 tests passed**.
- Repair acceptance regression, before the inserted-row fix:
  `npx vitest run src/__tests__/zen_free_model_bootstrap.test.ts`
  → **failed as expected**: the existing Config Doctor row missing `config_doctor_prompt_v2` was changed to `opencode`, rather than historical v2's `anthropic` route.
- Final focused/provider/replay checks:
  `npx vitest run src/__tests__/zen_free_model_bootstrap.test.ts src/__tests__/rhythm_setup_seed.test.ts src/__tests__/config_seeds_seeder.test.ts src/__tests__/migrations_replay_guard.test.ts src/__tests__/opencode_client_service.test.ts`
  → **5 files / 34 tests passed**.
- Final API static/build checks: `node_modules/.bin/tsc --noEmit && npm run build` → **passed**.
- Final skill/whitespace checks:
  `cmp -s apps/api_server/config_seeds/skills/zen-free-models/SKILL.md "$HOME/.config/opencode/skills/zen-free-models/SKILL.md" && git diff --check`
  → **passed**.
- Post-repair `node_modules/.bin/tsc --noEmit && npm run build` → **passed**.
- Full API suite on this branch: `npm test -- --fileParallelism=false` → **479 files passed, 6 failed, 86 skipped; 4033 tests passed, 9 failed, 129 skipped**. The 9 failures are exactly reproduced on clean `main` at `617d9045` (run in disposable `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-main-baseline`): two `memory_injection`, `memory_index_rebuild`, two `issue_1219_memory_provenance`, two `agent_research_owner_visibility`, `delegation_caller_identity`, and `issue_1135_audit_lock_contract`. Main reports **478 files passed, 6 failed, 85 skipped; 4031 tests passed, 9 failed, 128 skipped**. The one extra passing/skipped file on this branch is this feature's new live-gated contract; all failures are baseline, not regressions from this work.
- `cmp -s apps/api_server/config_seeds/skills/zen-free-models/SKILL.md ~/.config/opencode/skills/zen-free-models/SKILL.md` → **passed**.
- GitNexus impacts before edits: `runMigrations` and `seedConfigAssets` were **LOW** risk (no indexed direct callers/processes). Post-change `gitnexus_detect_changes({scope:'compare', base_ref:'main'})` reports **low** risk, 7 changed symbols across the branch, and **no affected processes**.

## Notes

- Existing rows remain outside this feature: Config Doctor's new Zen update is conditioned on `INSERT OR IGNORE` reporting an inserted row, while rhythm-setup has no feature update path beyond its insert. The regression explicitly simulates Config Doctor without its v2 marker and confirms the original v2 repair runs without adding Zen or its skill.
- `cmp -s config_seeds/skills/zen-free-models/SKILL.md "$HOME/.config/opencode/skills/zen-free-models/SKILL.md"` → **passed** (byte-identical). The privacy policy itself remains manual review (`task-zen-free-model-bootstrap-c4`).
- WAIVED: bookkeeping-only identity correction; verification is: focused contract tests, JSON parse, `git diff --check`, and scoped legacy-identity search.
- Bookkeeping correction: contract is no-issue (`issue: null`) at `docs/ai/contracts/zen-free-model-bootstrap.json`; the 34 focused tests, JSON parse, whitespace check, and changed-file legacy-identity search passed.
- Zen availability is inherently time-sensitive. Last approved probe roster: available `deepseek-v4-flash-free`, `laguna-s-2.1-free`, `longcat-2.0-free`, `mimo-v2.5-free`, `nemotron-3-ultra-free`, `big-pickle`; unavailable `north-mini-code-free` and both Ling free variants.

## Expiry fallback follow-up

### Files

- `apps/api_server/src/services/agent_model_resolver.ts` — keyless-only local catalog fallback for stale Zen ids; credentialed Zen configs remain unchanged.
- `apps/api_server/src/services/opencode_client_service.ts` — narrow auth-store-only accessor that distinguishes credentialed from keyless providers.
- `apps/api_server/src/__tests__/agent_model_resolver_zen_fallback.test.ts` and `zen_free_model_bootstrap_live_e2e.test.ts` — stale-catalog unit and observable live contracts.
- `tools/dev/zen-probe.mjs`, both `zen-free-models/SKILL.md` copies, and `docs/ai/testing-guide.md` — manual probe and operator guidance.

### Contract

- Failing pre-implementation run: `cd apps/api_server && npx vitest run src/__tests__/agent_model_resolver_zen_fallback.test.ts` → **3 failed / 2 passed**. Stale ids were returned unchanged instead of the pinned fallback, first catalog entry, or `undefined` for an empty catalog.
- Contract: `docs/ai/contracts/zen-free-model-bootstrap.json`; the initial c10 launch was deferred by sandbox ownership safety. Resumed verification completed successfully: **all 12 criteria pass; `not_tested` is 0**.

### Checks

- `npx vitest run src/__tests__/agent_model_resolver_zen_fallback.test.ts src/__tests__/zen_free_model_bootstrap.test.ts src/__tests__/rhythm_setup_seed.test.ts src/__tests__/config_seeds_seeder.test.ts src/__tests__/migrations_replay_guard.test.ts src/__tests__/opencode_client_service.test.ts` → **6 files / 39 passed**.
- `node_modules/.bin/tsc --noEmit && npm run build` → **passed**.
- `cmp -s apps/api_server/config_seeds/skills/zen-free-models/SKILL.md "$HOME/.config/opencode/skills/zen-free-models/SKILL.md" && git diff --check` → **passed**.
- `bun run build --single` in `apps/opencode_fork/packages/opencode` → **passed**.
- `node tools/dev/zen-probe.mjs` → exit **0** (the seeded model passed):

```text
north-mini-code-free   FAIL  HTTP 401: no choices                     256000   false
longcat-2.0-free       OK                                             1000000  false
ling-3.0-flash-free    OK                                             262144   false
laguna-s-2.1-free      OK                                             256000   false
deepseek-v4-flash-free OK                                             200000   false
ling-3.0-tiny-free     OK                                             262144   false
mimo-v2.5-free         OK                                             200000   true
big-pickle             OK                                             200000   false
nemotron-3-ultra-free  FAIL  The operation was aborted due to timeout 1000000  false
```
- Initial required live launch used only `tools/dev/sandbox.sh` with `RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-fresh-install/rhythm.db`, empty source HOME, and API/engine ports `4098/4097`. It was initially blocked: `sandbox: port :4098 is occupied; refusing to touch it`. Scoped `down` then failed closed: `sandbox engine port :4097 is occupied without a recorded engine PID; refusing to kill it`. `status`/`lsof` showed API PID **54230** and engine PID **54254** listening; they were not killed manually. The resumed verification below superseded this transient launch-block evidence.
- `gitnexus_detect_changes({scope:'compare', base_ref:'main'})` → **low** risk; 10 changed symbols, 0 affected processes.

### Notes

- GitNexus pre-edit impact: `resolveModelFromAgentConfigs` and `OpencodeClientService` were both **LOW** (0 indexed callers/processes); the indexed `listAuthedProviders` method could not be resolved on this branch, so the containing class was analyzed.
- No scheduler, cron, auto-assignment, or profile mutation mechanism was added. The fallback is a per-turn local catalog lookup only; it never makes a network completion request.

### Resumed live verification

- WAIVED: documentation-only evidence repair; verification is: reconcile the recorded gate evidence and run `git diff --check`.
- Final gate rerun: the focused six-file suite passed **39 tests**; `node_modules/.bin/tsc --noEmit && npm run build` passed; and `node tools/dev/zen-probe.mjs` exited **0**, including `deepseek-v4-flash-free OK` for the seeded model.
- With `HOME=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-fresh-install/empty-source-home` (no `auth.json`) and source DB `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/zen-fresh-install/rhythm.db`, `tools/dev/sandbox.sh up` launched only API `:4098` and engine `:4097`. The live contract ran with both `DB_PATH` and `RHYTHM_LIVE_DB_PATH` set to the disposable sandbox copy, changed only `rhythm-setup` to `does-not-exist-free`, and passed: **1 file / 1 test**, exact persisted output `zen-bootstrap-ok`.
- The first immediate post-idle transcript read raced persistence; the live contract now polls the existing messages endpoint for up to 30 seconds, while retaining its exact output assertion. No runtime code changed.
- `tools/dev/sandbox.sh down` completed after every launch; sandbox cleanup was confirmed. Final listeners: `4097/4098/4099` empty; live API PID `50975` remained on `4001` and live engine PID `50995` remained on `4096`.
