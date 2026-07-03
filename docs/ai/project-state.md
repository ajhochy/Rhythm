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

### 2026-07-02 — issue-863-quick-actions
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/models/quick_action_context.dart` (new) — generic `{kind, sourceId, title, description}` value object so the shared quick-actions widget doesn't depend on Task/ProjectInstance/MessageThread models directly.
  - `apps/desktop_flutter/lib/features/agents/views/quick_actions_bar.dart` (new) — shared `QuickActionsBar` widget: 4 one-tap buttons ("Help me finish this", "Draft next steps", "Summarize", "Create follow-up tasks"), each a preset agent invocation with zero typing required.
  - `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart` — added a "Quick Actions" `_InspectorSection` to the task inspector's `aside` column (last, after Metadata, to avoid shifting the existing "Add collaborator" button position — see Deviations).
  - `apps/desktop_flutter/lib/features/dashboard/views/dashboard_view.dart` — added `_NextTaskQuickActionsCard`, shown under the hero panel for the single most relevant open task (today's first, else this week's first).
  - `apps/desktop_flutter/test/features/agents/quick_actions_bar_test.dart` (new) — 7 widget tests covering all 4 actions, real task creation + linking, session-ready callback, and visible-failure-on-createSession-error.
- Checks run:
  - `flutter test` (full suite): 754/754 pass (0 regressions; baseline was 747 before the 7 new tests).
  - `flutter analyze --no-fatal-infos`: 0 errors/warnings (267 pre-existing info-level lints, unchanged from baseline).
  - `dart format . --set-exit-if-changed`: clean (0 changed after auto-format applied once to the new widget file).
- Decisions made:
  - Reused `AgentsController.createSession(mcpRole: 'secretary')` + `selectSession` + `sendInput` — the exact same session-creation path as `agent_email_view.dart`/`agent_gallery_view.dart` — but call `sendInput` immediately after `selectSession` instead of `setComposerDraft`, since #863 requires zero user typing (the draft pattern still needs the user to press Enter). Guarded on `agentsController.connectivity.isWsDisconnected` before sending, since `AgentsDataSource.send` silently drops frames when the WS channel is null (confirmed via source read + a background research agent) — this makes the "failure is visible" acceptance criterion hold even though `sendInput` itself has no delivery confirmation.
  - "Create follow-up tasks" directly calls `TasksController.createTask(...)` client-side (deterministic, testable, guaranteed real+linked task) rather than relying on an agent's tool call to create it (non-deterministic, unverifiable in a widget test) — then additionally launches a secretary-agent session to propose further follow-ups, satisfying both the "real Rhythm task" and "preset agent invocation" halves of the acceptance criteria.
  - Placed the task-inspector's Quick Actions section LAST in the `aside` column, not first, after discovering `test/features/tasks/issue_651_contract_test.dart` taps "Add collaborator" without scrolling — inserting a new section above it pushed the button out of the pre-scroll hit-test area. Appending after "Metadata" avoids shifting any already-tested content.
  - No new provider wiring in `main.dart`/`app_shell.dart` — `AgentsController` and `TasksController` are already globally provided; `QuickActionsBar` and `_NextTaskQuickActionsCard` consume them via `context.read`.
- Deviations from spec: none functionally; the dashboard placement (a small card for the single next task, not a bar embedded in every task row) was chosen to avoid touching the heavily-shared `FocusBusinessProjectProgress`/`_TaskPreviewRow` widgets, keeping the change additive and low-conflict-risk per the "minimize fold conflicts" constraint.
- Concerns:
  - `sendInput` has no delivery confirmation beyond the `isWsDisconnected` connectivity flag; a mid-flight disconnect between the check and the actual `send()` call would still silently drop the prompt (pre-existing repo-wide limitation of `AgentsDataSource.send`, not introduced by this change).
  - `TasksController.errorMessage` is controller-global state; a stale error from an unrelated prior action could theoretically leak into the follow-up-task failure check (pre-existing `TasksController` API shape, reused as-is).
  - No widget test was added directly for `dashboard_view.dart`'s new card (no existing dashboard test harness to extend within scope); verified via `flutter analyze` (0 issues) and manual code trace only.
