# Project State

## Current focus

The 2026-07-02 build-out is complete and parked in open PRs for review. It
delivered the Org Self-Optimizer epic (#816), token-efficiency, the life-layer,
fork-in-dev enablement, and a repointed Obsidian-vault memory system — all
verified LIVE against the real fork. Remaining work is the governance/safety
gaps the live run exposed (#856–#860), none merged.

## Active branch / PR (all open — never auto-merge)

- **#848** `codex/mega-2026-07-02` — the mega integration (~20 tracks). Server +
  Desktop + MCP CI green. Closes on merge: #817–#831, #834, #841, #842, #844,
  #845, #846, #847, #850, #851, #852, #853, #854, #855.
- **#849** — fork deferred MCP tool loading (#843); needs a signed-release smoke.
- **#836** — local Qwen via Ollama (opt-in, cloud-first).
- **#840** — earlier docs snapshot (superseded by the current docs on merge).
- Pre-existing: **#832** (optimizer plan docs), **#835** (local MCP sidecar).

## Running the fork engine in dev (IMPORTANT)

`flutter run` does NOT use the fork by default — it falls back to stock
`~/.opencode/bin/opencode` (v1.14.40, none of the scoping/skill/deferred patches).
To run the fork in dev:
1. `cd apps/opencode_fork/packages/opencode && bun install && bun run build --single`
   → `dist/opencode-darwin-arm64/bin/opencode` (`0.0.0-codex/...`).
2. `cp` it to `apps/opencode_bin/opencode` (dev discovery path) + `chmod +x`.
3. Ad-hoc sign: `codesign --force --sign - --entitlements <disable-library-validation plist> --options runtime apps/opencode_bin/opencode`.
4. Relaunch. Startup log states the engine + whether fork patches are active.
`RHYTHM_OPENCODE_BIN[_DIR]` env overrides also work (#855). `apps/opencode_bin/`
is untracked — rebuild per machine.

## Memory system (repointed + verified live)

- Agent memory lives at `~/Documents/Obsidian Vault/AGENT-MEMORY/<kind>/<slug>.md`
  (kinds: fact|person|project|preference|context). Set via
  `MEMORY_VAULT_PATH=<vault>/AGENT-MEMORY` + `MEMORY_VAULT_SUBDIR=""` (default
  `memory` for back-compat). Decision: `2026-07-02-agent-memory-in-obsidian-vault.md`.
- Injection = top-5 relevance per turn + on-demand `rhythm_search_memory`. Runs are
  NOT memory (fetched on demand via a `context` pointer → `Runs.base` /
  `Projects/<repo>/ai-runs/`). Verified live: injection, agent remember→vault+index,
  self-healing sync all work; integrity solid (no dupes/loss).

## Risks / known issues (open work, not merged)

- **#857 (CRITICAL): optimizer NOT safe unsupervised.** First live run auto-applied
  16 tighten/prune proposals on THIN history, stripping tools agents use; reverted
  by hand. Needs a minimum-observation-window guard + a revert-from-`active` path.
  **Keep the seeded optimizer cron (#830) OFF until #857 lands.**
- **#860: two parallel memory stores** — Obsidian AGENT-MEMORY vs the `memory`
  knowledge-graph MCP (`~/Documents/Claude-Memory/memory.jsonl`), both in agent
  scope. Split-brain vs single-source-of-truth.
- **#859: memory over-remember** — agents wrote 16 near-duplicate preferences in
  one session; needs write-time dedup + a consolidation pass.
- **#858: UUID-keyed agents can't chat** — session-create sends the config id, not
  `oc_agent` name → "Agent not found" (AI/Theological Researcher, Org
  Optimizer/Discovery). Data corrected; code fix open. Workaround: slug-keyed agents.
- **#856: engine caches provider creds** — Claude account switch needs an app
  restart. Quality-of-life.
- Fork binary in dev is per-machine (unsigned ad-hoc); release path unchanged.
- No `PATCH /agent-configs/:id` route — ops edits need direct SQL (noted in #858).
- 12 npm audit findings; #768 (remove cowork MCP); #814 (pin rhythm MCP version).

## Test status

- Mega branch: tsc clean; full vitest ~213 files / ~1839 pass / 1 skip;
  `smoke_org_optimizer.sh` exit 0; Flutter analyze + agent_optimizer/agent_skills
  green; Server + Desktop + MCP CI green.
- Live (fork engine, `apps/opencode_bin`): MCP scoping trims to scoped tool set
  (secretary 44 tools, not ~150K); optimizer loop wrote 16 proposals; delegation
  guardrails enforce; memory loop verified end-to-end on AGENT-MEMORY.

## Next step

1. **#857 first** — data-sufficiency guard + revert-from-active; optimizer cron stays OFF until then.
2. Review/merge PRs #848 (+#849 after a signed-release fork smoke, #836 as opt-in).
   On merge, resolve `docs/ai/project-state.md` in favor of the branch copy.
3. Memory governance: **#859** (write-time dedup + consolidation) and **#860**
   (collapse the two stores into the Obsidian vault).
4. **#858** (session-create uses `oc_agent`; sync backfills `oc_agent`) to make
   UUID-keyed agents chat-usable; consider a `PATCH /agent-configs/:id` route.
5. **#856** engine credential reload (quality-of-life).
6. Optional: hand-prune the 16 near-duplicate preferences in `AGENT-MEMORY/preference/`.

## Filed this run (2026-07-02): #854 #855 #856 #857 #858 #859 #860 (see runs/2026-07-02-mega-buildout-fork-eval-memory.md)

## Recent coding-agent runs

### 2026-07-02 — #814 pin/bundle rhythm MCP server version
- Files modified: `apps/api_server/src/services/opencode_client_service.ts`
  (new `resolveRhythmMcpCommand()` + `readRhythmMcpServerVersion()`;
  `ensureRhythmMcp()` now calls the resolver instead of hardcoding argv);
  `apps/api_server/src/__tests__/opc_rhythm_mcp_ensure.test.ts` (fixture now
  derives `DESIRED.command` from the resolver instead of the old bare spec);
  `apps/api_server/src/__tests__/opc_rhythm_mcp_command.test.ts` (new, 11
  tests); `.github/workflows/desktop_release.yml` (new bundling steps: build
  `apps/mcp_server`, copy `dist/+package.json/-lock+node_modules` into
  `Contents/Resources/mcp_server`, verify payload).
- Checks run: `tsc --noEmit` (api_server) — pass. `vitest run` full suite —
  215 files / 1855 pass / 1 pre-existing skip. `apps/mcp_server`: `npm run
  build` (tsc --noCheck) — pass. `desktop_release.yml` YAML parsed with
  `python3 -c "import yaml..."` — valid syntax (not run through actual CI in
  this session).
- Decisions made: bundle-with-pinned-fallback per issue recommendation; see
  `docs/ai/decisions/2026-07-02-pin-bundle-rhythm-mcp-version.md` for the full
  resolution order, alternatives, and follow-up risk note.
- Deviations from spec: none. Real-binary smoke (spawn + assert `tools/list`
  contains `rhythm_remember_memory`/`rhythm_list_sessions`) not run in this
  env; documented as a manual step in the new test file's trailing comment,
  backed by a source grep confirming both tools exist in
  `apps/mcp_server/src/tools/{agentMemory,agentSessions}.ts`.
- Concerns: the new `desktop_release.yml` bundling steps are untested by an
  actual CI run — flagged as a follow-up in the decision doc (low risk:
  mcp_server's only runtime deps, `@modelcontextprotocol/sdk` and `zod`, are
  pure JS with no native bindings, unlike `better-sqlite3` in api_server).

### 2026-07-02 — #856 reload provider credentials on auth change
- Files modified: `apps/api_server/src/services/auth_credential_watcher.ts`
  (new — pure `decideReload()` decision function + `AuthCredentialWatcher`
  class with injectable fs/timer deps); `apps/api_server/src/services/
  auth_credential_watcher.test.ts` (new, 11 tests); `apps/api_server/src/
  services/opencode_client_service.ts` (`EngineStatus` gained `'reloading'`;
  new `reloadCredentials()` method does dispose()+initialize() bounce;
  `statusMessage` surfaces `'Reloading credentials…'`; added
  `currentStatusForLogging()` helper to work around a TS narrowing quirk);
  `apps/api_server/src/services/opencode_client_service.test.ts` (new
  `describe('reloadCredentials (#856)')`, 5 tests); `apps/api_server/src/
  server.ts` (wires `AuthCredentialWatcher` watching `~/.local/share/
  opencode/auth.json`, started after `opencodeClient.initialize()` inside the
  `agentExecutionEnabled` block; stopped in the shutdown handler).
- Checks run: `tsc --noEmit` (api_server) — pass. `vitest run` full suite —
  216 files / 1871 pass / 1 pre-existing skip (up from 215/1855 after #814;
  16 new tests, no regressions).
- Decisions made: api_server-side fs.watch + debounce, NOT an in-engine/fork
  change (per the issue's lowest-risk guidance); a full dispose()+initialize()
  bounce rather than a partial re-`restoreAuth()`, because the issue's own
  diagnosis is that the SDK client/subprocess hold the stale token beyond
  what re-calling `setAuth`/`setOAuthCredentials` alone would override. See
  `docs/ai/decisions/2026-07-02-auth-credential-watcher-bounce.md` for full
  rationale, alternatives, and the desired UX message state
  (`statusMessage === 'Reloading credentials…'` while `status ===
  'reloading'`).
- Deviations from spec: none. No Flutter-side UI change made — the desktop
  client already polls the existing `statusMessage`/`isReady` surface, so it
  picks up the new message without further api_server work, but a follow-up
  should verify the client's UI treatment is prominent enough (noted in the
  decision doc).
- Concerns: no end-to-end test spawns a real opencode engine and rewrites a
  real `auth.json` — `initialize()`/`dispose()` are spied/mocked in the
  `reloadCredentials()` unit tests (the standard seam already used elsewhere
  in this file, since the real SDK spawn is a dynamic ESM import not
  exercised in the unit suite). A manual account-switch smoke is recommended
  before considering #856 fully closed.
