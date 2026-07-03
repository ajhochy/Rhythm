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

### 2026-07-02 — issue #861 (Task card delegation navigation, worktree `861-taskcard` / branch `issue-861-task-card-nav`)
- Files modified:
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — `getChildren`
    and `getChildMessages` no longer 404 when `:id` has no local DB row; child
    sessions never have one by design, so absence is now treated as "`:id` is
    itself a child/grandchild SDK session id" and the SDK call proceeds
    directly. This was the backend blocker for nested (grandchild+) delegation.
  - `apps/api_server/src/__tests__/opc_m3_6_child_sessions.test.ts` — replaced
    the two `unknown-session → 404` assertions (no longer the contract) with
    nested-lookup tests (`issue-861-c1a-nested*`, `issue-861-c1b-nested`).
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
    — `AgentsController`'s child-session navigation state changed from a
    single slot (`_activeChildSessionId` etc.) to a `List<_ChildFrame>` stack,
    so `closeChildSession()` pops one hop instead of always returning to the
    top-level parent. Added `activeChildDisplayName` and `childStackDepth`;
    `openChildSession` gained an optional `childDisplayName` param.
  - `apps/desktop_flutter/lib/features/agents/views/_tool_renderers/_task_chip.dart`
    — passes its own description as `childDisplayName` on tap.
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` —
    `ChildTranscriptView` gained an `ownDisplayName` field and now renders any
    `task` tool parts in a child message as nested, tappable `TaskChip`s
    (previously collapsed to a `⚙ task` text summary, so grandchild delegation
    was never clickable at all).
  - `apps/desktop_flutter/test/features/agents/issue_861_nested_task_card_nav_test.dart`
    (new) — mounted-surface tests pumping the real `AgentsView` (not an
    isolated widget), covering: tapping a top-level Task card opens the child
    in the real chat pane; a nested Task card inside that child opens a
    grandchild with the breadcrumb correctly pointing at the intermediate
    child (not the top-level parent); back navigation pops one hop at a time;
    an unresolvable child id renders a disabled/non-clickable card.
- Checks run:
  - `cd apps/api_server && node_modules/.bin/tsc --noEmit` — pass, no errors.
  - `cd apps/api_server && node_modules/.bin/vitest run src/__tests__` — 178
    files / 1542 passed / 1 pre-existing skip.
  - `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — 267
    pre-existing info-level lints, 0 errors, no new issues vs baseline.
  - `cd apps/desktop_flutter && flutter test test/features/agents/` — 473
    tests, all passed (includes the new mounted-surface nested-delegation
    tests and the pre-existing `opc_m3_6_child_sessions_test.dart` unchanged).
  - `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — clean
    (0 files changed on the final run; two files were auto-formatted once and
    re-verified).
- Decisions made:
  - Single-hop child navigation (#699 / OPC-M3-6, already on `main`) covered
    top-level Task-card → child transcript + breadcrumb-back + disabled state,
    but nested delegation (parent → orchestrator → specialist) was NOT
    implemented: the controller only tracked one active child, and
    `ChildTranscriptView` rendered nested `task` tool parts as inert text, so
    a grandchild's card was never even shown, let alone tappable. Backend
    `getChildren`/`getChildMessages` additionally 404'd on any id without a
    local DB row, which is exactly what a child's own SDK id looks like. This
    run closes that specific gap rather than re-doing #699's already-shipped
    single-hop path.
  - Chose a navigation STACK (`List<_ChildFrame>`) over recursively nesting
    widgets, so `closeChildSession()` naturally pops one level and the
    existing single-slot public getters (`activeChildSessionId`,
    `activeChildParentName`) keep their pre-#861 meaning for one-hop callers
    (top of stack / that frame's breadcrumb target).
  - Backend fix relaxes rather than removes the 404: when `:id` DOES resolve
    to a local row, existing single-hop behavior (mapped SDK id, empty array
    on no active mapping) is unchanged. Only the "no local row" branch changed
    from "404" to "treat as a raw SDK id and ask the SDK" — the SDK's own
    404/502 on a genuinely bad id still surfaces via `next(err)`.
- Deviations from spec: none — nested delegation, per-hop breadcrumb, and
  disabled/unresolvable-card behavior all match the issue's acceptance
  criteria.
- Concerns:
  - `AgentsController.selectSession()` does not reset the child-navigation
    stack when switching to a different top-level session. This is pre-#861
    behavior (unchanged by this run) — flagged here in case a future session
    switch while a child view is open surfaces a stale child transcript.
  - The grandchild fixture ids in the new test had to avoid underscores
    after the `ses_` prefix, matching a real constraint in
    `_task_chip.dart`'s `task_id: ses_[A-Za-z0-9]+` output-parsing regex
    (it truncates at the first non-alphanumeric character). Real opencode
    ids never contain underscores, so this is not a product bug, but it is
    a sharp edge for anyone hand-writing future fixtures.
