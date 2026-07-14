---
date: 2026-07-14
repo: Rhythm
branch: main
status: planning
issues: []
tags: [plan, Rhythm, dev-sandbox]
index: "[[Rhythm]]"
---

# Plan — Isolated dev sandbox: develop/build/run/test Rhythm from within the live Rhythm app

Supersedes the 2026-07-03 open-issues plan (all its issues merged). Planning
only — no product code in this pass.

## Intent + constraints

1. **Goal (one sentence):** an agent session running inside the live Rhythm app
   can build, launch, and test a full second Rhythm backend (api_server + fork
   engine + scheduler) on the same Mac without touching the live `:4001`
   server, its engine, its DB, its config dirs, or its 3 in-process run slots.
2. **In scope:** one small engine-port code change, a `tools/dev/sandbox.sh`
   lifecycle script, docs. **Not in scope:** containers, Postgres sandboxing,
   Flutter-client sandboxing, CI changes, prod deployment, a UI for sandboxes.
3. **Hard constraints:** production posture (draft PR only, additive changes —
   `AGENTS.md`); never SIGKILL the live engine; never write the real
   `~/.config/opencode`, `~/.local/share/opencode`, Memory-Vault, or live DB;
   sandbox scheduler must not duplicate real side effects (emails, PCO);
   SQLite-only test infra (`docs/ai/project-state.md` risk #2).
4. **Design tension:** fidelity (real DB copy, real auth, real scheduler) vs
   safety (no duplicate side effects). Resolved: copy real data, but disable
   all scheduled tasks in the copy; re-enable only the task under test.
5. **Cheapest end-to-end proof:** the existing plan-B manual recipe
   (`docs/superpowers/plans/2026-07-09-plan-B-stage-b-discover-adopt.md`
   §"Launch the api_server standalone", `PORT=4099 DB_PATH=$SB/rhythm.db …
   node dist/server.js --parent-pid=1`) already works **when the live app is
   quit**. The entire delta to "live app running" is the engine-port collision
   plus HOME isolation. That is the MVP.

## Clarification interview

Skipped — the orchestrator prompt enumerated deliverables (1)–(6), the
isolation surfaces to evaluate, and the YAGNI constraint explicitly; the one
motivating incident (stuck daily-dev-summary slot) was described. Remaining
unknowns are recorded under **Known Ambiguities** rather than guessed.

## Prior Art

- **In-repo (primary):** plan-B standalone recipe (above); live-E2E harness
  (`src/__tests__/live_e2e_inert_regressions.test.ts` — refuses `:4001` at
  line 163–164; copied DB + temp HOME + spare port per
  `docs/ai/testing-guide.md`); behavioral-pass harness
  (`docs/testing/behavioral-pass-2026-07-11.md` — ":4099, HOME with real
  auth, DB copy … so the real app/DB is untouched"). The plan reuses these
  patterns verbatim rather than inventing new ones.
- **External:** research job `117102b3-806e-482d-89b9-b7d3df3ce3ff`
  (rhythm_start_research) on same-machine sandbox isolation failure modes;
  archived trend research (2026-07-11, Codex Control Plane MCP / Toolport /
  Athena Loops) confirms durable-detached orchestration is a real category —
  and that `nohup` + PID file + health poll is the minimum viable form of it.
  Anti-pattern to avoid (from the port-reclaim reading below): "stale process"
  heuristics that match *siblings*, not just orphans.

## (1) What exists now — cited

| Surface | Fact | Source |
|---|---|---|
| API port | `env.port` = `PORT` env, default 4000; live agent server runs on 4001 | `apps/api_server/src/config/env.ts:147`; `docs/ai/architecture.md` dual-server table |
| DB | `DB_CLIENT` default sqlite; `DB_PATH` env, default `cwd/rhythm.db`; live DB at `~/Library/Application Support/Rhythm/rhythm.db` | `env.ts:157–158`; plan-B recipe |
| Concurrency | `MAX_CONCURRENT_AGENT_RUNS` env, default 3; gate is a **module-level in-process Set** (`_activeRuns`) — per process, not per machine | `services/agent_runner.ts:37, 219–236` |
| Stale runs | `resetStaleRunning` fires at scheduler **boot**; per-tick orphan reaper exists (#1039 Cause C) | `services/agentSchedulerService.ts:404–411, 422` |
| Scheduler | started unconditionally when agent execution enabled | `src/server.ts:129` |
| Engine port | `OPENCODE_ENGINE_PORT = 4096` **hard constant, no env override**; `createOpencode({})` called with no port | `services/opencode_client_service.ts:70, 704` |
| SDK supports port | `ServerOptions.port` exists; SDK default 4096; engine child inherits `process.env` (so `HOME` propagates) | `node_modules/@opencode-ai/sdk/dist/server.d.ts`, `server.js` |
| Port reclaim | boot-time `reclaimStalePortForOpencode(4096)` SIGTERM→SIGKILLs **any** `opencode serve` on the port — no parent/ownership check | `opencode_client_service.ts:106–117, 172–218, 673–674` |
| HOME-relative config | agent projection dir = `homedir()/.config/opencode/agents` (respects `$HOME`); opencode auth/storage under `~/.local/share/opencode`; `restoreAuth()` re-loads auth.json after spawn | `services/opencode_agent_writer.ts:239–241`; `opencode_client_service.ts:713–718`; `docs/ai/architecture.md` auth model |
| Env overrides already shipped | `RHYTHM_OPENCODE_BIN_DIR`/`_BIN` (fork binary), `RHYTHM_MANAGED_SKILLS_DIR`, `MEMORY_VAULT_PATH`, `AGENT_LOCAL`, `RHYTHM_ROLE`, `APPROVALS_MODE` (default `manual`), `AGENT_RUN_TIMEOUT_MS` | `env.ts`; `testing-guide.md` §fork-in-dev; plan-B recipe; `behavioral-pass-2026-07-11.md` #1008 |
| Detach support | `node dist/server.js --parent-pid=1` runs the server without a watchdog parent | plan-B recipe step 4 |
| Health check | `GET /health` (used by every existing harness); `GET /opencode/health` for the engine | plan-B step 4; `testing-guide.md` smoke checklist |
| Script home | `tools/dev/` already hosts `agent_eval.sh`, `launch_desktop_current.sh` | `tools/dev/` |

## (2) Root collision / failure risks

1. **R1 — engine-port fratricide (critical, the blocker).** A second
   api_server booting while the live app runs reaches "Phase 4: reclaim stale
   port" and kills the **live** engine on :4096 (`isStaleOpencodeCommand`
   matches any `opencode serve`, no parentage check), then binds :4096
   itself. Live sessions die mid-turn. This is why every prior harness run
   implicitly required the live app to be quit.
2. **R2 — shared HOME.** Agent-file projection, managed skills, engine
   session storage, and `auth.json` all live under `$HOME`; a sandbox server
   with real HOME stomps live config (the exact boot-stomp bug family from
   `docs/ai/runs/2026-07-11-boot-stomp-class-fix.md`).
3. **R3 — duplicate scheduled jobs.** The sandbox scheduler + `AGENT_LOCAL=true`
   → AgentRunner will *really run* every enabled `agent_scheduled_tasks` row in
   the copied DB (emails, notifications, PCO writes, provider spend).
4. **R4 — Memory-Vault writes.** Default `MEMORY_VAULT_PATH` points at the real
   Obsidian vault; sandbox mirror-sync would write it.
5. **R5 — shared run slots (the motivating incident).** The 3-slot gate is
   in-process; a stuck run in the live server holds a live slot until
   restart. Any test that routes through the live server competes for (and
   can be blocked by) those slots.
6. **R6 — torn DB copy.** `cp` of a hot WAL-mode SQLite DB (live app running)
   can produce an inconsistent copy; must use `sqlite3 "$src" ".backup $dst"`.

## (3) Recommended MVP architecture — exact isolation boundaries

One sandbox = **one directory + one env profile + one detached process tree.**
No containers (R1–R6 are all solved by ports/paths/env; a container adds a
macOS VM boundary that breaks the fork-binary and Flutter toolchain for zero
additional isolation we need).

| Boundary | Live | Sandbox | Mechanism |
|---|---|---|---|
| Checkout | `~/Documents/Rhythm` | `~/Documents/Rhythm-sb` (git worktree, feature branch) | `git worktree add` — parallel builds, no branch flips under the live checkout |
| API port | 4001 | **4098** | `PORT=4098` (existing env) |
| Engine port | 4096 | **4097** | **new** `RHYTHM_OPENCODE_ENGINE_PORT` env (only code change); reclaim then targets 4097 where nothing live listens → R1 gone |
| HOME | real | `$SB/home` with real `auth.json` copied in | `HOME=$SB/home` (Node `homedir()` + SDK child env both respect it) → R2 gone |
| DB | live sqlite | `$SB/rhythm.db` via `.backup` | `DB_PATH` (existing) → R6 gone |
| Scheduled tasks | enabled | `UPDATE agent_scheduled_tasks SET enabled=0` in the copy; re-enable the one under test | zero-code, in-DB → R3 gone |
| Memory vault | real | `$SB/vault` | `MEMORY_VAULT_PATH` (existing) → R4 gone |
| Skills | real | `$SB/home/.config/opencode/skills` (copied) | falls out of HOME redirect (+ `RHYTHM_MANAGED_SKILLS_DIR` if needed) |
| Run slots | live pool of 3 | **own** pool, `MAX_CONCURRENT_AGENT_RUNS=2` | per-process by construction → R5 gone |
| Lifecycle | Flutter-managed | `nohup node dist/server.js --parent-pid=1` + PID file; health = poll `:4098/health` + `:4098/opencode/health`; cleanup = SIGTERM PID (engine child dies with it), free-port assert, `rm -rf $SB` | existing flags + stock unix |

## (4) Incremental implementation plan — issue table

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|---|---|---|---|---|---|
| 1 | Engine port env override `RHYTHM_OPENCODE_ENGINE_PORT` | Second instance can spawn its engine on a non-4096 port; unset = byte-identical 4096 default | `apps/api_server/src/services/opencode_client_service.ts` (resolve port from env at init; pass `{ port }` to `createOpencode`; use same value in `reclaimStalePortForOpencode` call), `apps/api_server/src/services/pty_proxy.ts` (URL uses resolved port) | Unit: extend `src/__tests__/issue_655_contract.test.ts` + `opencode_client_service.test.ts` — env set → reclaim/spawn/pty all use override; env unset → 4096. **Live behavioral (AGENTS.md gate):** launch sandbox with override while live app runs; assert `lsof -iTCP:4096` PID unchanged, live `:4001/health` ok, sandbox `:4098/opencode/health` ready. Record in `docs/ai/runs/` | — |
| 2 | `tools/dev/sandbox.sh` (`up` / `down` / `status`) | One command automates the proven plan-B recipe safely: worktree-aware build, `sqlite3 .backup` DB copy, temp HOME + `auth.json` + skills copy, scheduled-task disable, env profile, `nohup` launch, health wait, PID file; `down` kills + asserts ports free + removes `$SB` | `tools/dev/sandbox.sh` (new), reuses plan-B env lines verbatim | Bash smoke (self-check in script or `tools/dev/__tests__/`): `up` twice is idempotent-or-clear-error; `down` after SIGKILLed server still cleans up; with live app running, live 4001/4096 PIDs unchanged across `up`/`down` | 1 |
| 3 | Docs + decision record | Single canonical recipe; retire scattered copies | `docs/ai/testing-guide.md` (new "Isolated dev sandbox" section), `docs/ai/decisions/2026-07-XX-dev-sandbox-isolation.md`, pointer from `AGENTS.md` behavioral-gate section | `ai-workflow status` clean; doc review | 1, 2 |
| 4 (optional) | `sandbox.sh --worktree <branch>` bootstrap | Create/refresh the `Rhythm-sb` worktree + `npm ci` + fork build in one step | `tools/dev/sandbox.sh` | Smoke: fresh worktree → `up` reaches healthy | 2 |

### Acceptance criteria (concrete)

- **AC1 (issue 1):** *Trigger:* start api_server with `RHYTHM_OPENCODE_ENGINE_PORT=4097` while the live app is running. *Observable:* startup log shows the engine spawned/reclaimed on 4097; `lsof -iTCP:4096 -sTCP:LISTEN` returns the same PID as before the launch; a live agent session in the app completes a turn during the sandbox boot. *Boundary:* env unset → engine on 4096 exactly as today (existing tests stay green); non-numeric value → clear startup error, no kill attempted. *Done:* live test recorded in `docs/ai/runs/`.
- **AC2 (issue 2):** *Trigger:* `tools/dev/sandbox.sh up` with the live app running. *Observable:* prints sandbox URL; `curl :4098/health` and `:4098/opencode/health` succeed; real `~/.config/opencode/agents` mtimes unchanged; real DB untouched; `sqlite3 $SB/rhythm.db "SELECT COUNT(*) FROM agent_scheduled_tasks WHERE enabled=1"` = 0. *Boundary:* port already occupied → fail with message, kill nothing; `down` when already dead → still removes `$SB` and exits 0. *Done:* `up`→scheduled-task trigger-now test→`down` leaves no listener on 4097/4098 and no `$SB` dir.
- **AC3 (issue 3):** a new agent can execute the sandbox flow from `testing-guide.md` alone, without reading plan-B or the behavioral-pass doc.

## (5) What to defer (and why)

- **Containers/VMs** — every risk is solved by ports+paths+env; macOS containers can't run the signed Flutter/fork toolchain natively anyway.
- **Parentage-hardening of `reclaimStalePortForOpencode`** — mitigated by distinct ports; touch it only if a real incident recurs.
- **Scheduler disable env flag** — the DB `UPDATE` in the copy is zero product code.
- **Durable job-orchestration layer** (Codex-Control-Plane-style) — `nohup` + PID file + `/health` is the minimum that satisfies "detached and durable"; upgrade only if sandbox runs must survive reboots.
- **Postgres sandbox, sandbox UI/MCP management tool, auto port allocation** — no current need; ports are constants in one script.

## (6) Concurrency pool — recommendation

**Do not share the live pool.** The gate is per-process by construction
(`_activeRuns` module Set, `agent_runner.ts:221`) — the sandbox process gets
its own slots for free, which is exactly what unblocks scheduled-task tests
when a live slot is wedged (the daily-dev-summary incident). Sharing would
require new cross-process coordination code and would *re-create* the failure
this plan exists to remove. Bound total machine load by setting
`MAX_CONCURRENT_AGENT_RUNS=2` in the sandbox env profile instead.

## Known Ambiguities

- **Flutter client in the sandbox:** MVP is headless (curl/WS), matching every
  existing harness. If visual smoke against the sandbox server is required,
  that's a follow-up (`flutter run` pointed at `:4098` — needs a client-side
  base-URL override and is out of MVP scope).
- **Canonical ports:** 4098 (API) / 4097 (engine) proposed; prior runs used
  4098/4099 ad hoc. Constants live in `sandbox.sh` — cheap to change.

## Data-safety notes

- Real `auth.json` is copied into the sandbox HOME (needed for real provider
  calls) — `$SB` must stay under the user's own tmp/home and be deleted by
  `down`; never commit `$SB` paths or contents.
- The DB copy contains real user data and integration tokens — same handling.
- Sandbox `APPROVALS_MODE` stays default `manual`; never set `off` in the
  profile.
