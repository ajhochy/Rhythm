---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: https://github.com/ajhochy/Rhythm/pull/1544
issues: [1568, 1552, 1576, 1581, 1559, 1575, 1547, 1558, 1577, 1574, 1573, 1559, 1565, 1491, 1579, 1582, 1572, 1468, 1569]
status: integrated-and-gated; manual smoke pending
tags: [run, rhythm, swarm]
index: "[[Rhythm]]"
---

# 2026-09-24 — open-issue swarm resume: ledger, integration, gate

Orchestrator: Claude (planner / integrator / reviewer). Inspectors: 15 read-only Codex
`gpt-6-astra` runs (one per preserved candidate worktree, `-C <worktree>`, structured
JSON ledger). Repairs: Codex `gpt-5.6-sol` (this account has no `gpt-6-sol`; every prior
Sol run also used `gpt-5.6-sol`). All verification below was run by the orchestrator, not
by Codex.

## Ledger (every preserved candidate)

| Candidate | Inspector class | Cap | Orchestrator decision |
|---|---|---|---|
| #1568 OpenAI usage (`swarm/issue-1568`) | salvageable | 2/2 | **Integrated** `9d225f41` — 32/32 focused unit, 45/45 after cherry-pick, live envelope test vs dedicated sandbox (see gate). Semantics note: partial-window siblings survive a malformed primary; HTTP status omitted from reason; #1566 expectation not updated. Issue stays open (G1 real-account and G2 UI are manual). |
| #1552 child-chip CSS (half of PR #1577) | sound | — | **Integrated** `d1662eee` — contract + rail specs 22 passed. Packaged Electron c6 manual. |
| #1576 B1 provenance ledger (`sol/1576-b1`) | salvageable | 1→2 | Repair 2 (string guards) → **Integrated** `bcf29c84` — 13/13, tsc clean. B2 wiring not started; issue open. |
| #1581 More dropdown (`swarm/issue-1581`) | salvageable | 2/2 | **Integrated** `ac3faa39` — contract 15/15 on isolated ports. Follow-ups: visible active state for hidden destinations; packaged smoke (c7). |
| #1559 Agent Settings isolation (`swarm/issue-1559`) | salvageable | 2/2 | **Integrated** `810e0b91` — contract 37/37; broader bucket-a suite 4 failures reproduce identically on base (pre-existing). Follow-ups: SettingsPage/LiveReviewTool still use fatal ListInspector error; failed follow-up GET after a mutation lacks Retry. |
| #1575 delegation worktrees (`swarm/issue-1575`) | salvageable | 1→2 | Repair 2 (persist child worktree triple immediately; `upsertResolvedChildSession` COALESCEs child-owned metadata) → **Integrated** `0ce3db89` — 7/7 focused, repository suite 28/28, MCP 1/1, tsc clean. GitNexus impact on the repository method: **HIGH** (resume/fork/create flows), covered by the repository suite; AJ standing approval applies. Live vs coordinator sandbox: c6 non-git rejection PASS; c4 (child reports cwd) timed out — the synthetic sandbox has no provider credential so no child turn runs. The sandbox log still shows the server created the worktree and routed the child there (`streamSession … directory=…/opencode/worktree/…` vs the manager's temp git dir). c4 stays a manual gate. |
| #1547 Google credentials | — | — | Already stacked as `e93eac6e` (slice `45088d26`); re-verified in the integrated gate. |
| #1558 collapsed projects (other half of PR #1577) | salvageable | 2/2 | **Deferred** — uncommitted repair lets a persisted `false` hide the selected session's group on load, contrary to issue criterion 2; committed HEAD references a removed setter. WIP snapshot `37d1bef8`. |
| #1577 prompt existing session (PR #1578) | unsafe | 2/2 | **Deferred** — `prompt()` sends no per-turn `agent`, so `handleInputFrame` resolves tool scope from `agentKind` instead of the stored `profileId` (verified in `ws_gateway.ts` `scopeAgentId = perTurnAgent ?? agentKind`); c9 fixture masks it by setting `opencodeAgentId = config.id`; legacy audit rows can be re-settled. Fix is bounded: pass `agent: session.profileId` server-side, never caller-supplied. WIP snapshot `5e0e93ae`. |
| #1574 Engraph ownership (`swarm/issue-1574`) | salvageable | 2/2 | **Deferred** — `reusedFrom` never cleared on re-spawn (disable leaves backend running), index child unsupervised, `backendCount` hides strays, legacy strays unhandled, `process.kill` test prohibition weakened. #1573 stays blocked. WIP `61718027`. |
| #1565 timestamps (`swarm/issue-1565`) | salvageable | 2/2 | **Deferred** — 10/10 unit + 2/2 spec pass, but Inspector.tsx still hard-codes a date / raw expiry, source guard misses mixed JSX, Transcript timestamp shrunk 11→8px, live rendering unverified. Formatter should be reused by #1582. WIP `18f39c11`. |
| #1491 webhook handoff (`swarm/issue-1491`) | salvageable | 2/2 | **Deferred** — Flutter `_maybeConsumeComposerDraft` consumes the webhook draft before rejecting an occupied composer (silent context loss); `postgres_bootstrap_live` expectations stale vs base. Production Postgres `claude_triggers` SELECT join needs the same review. WIP `957c73c7`. |
| #1579 Electron notifications (`swarm/issue-1579`) | salvageable | 2/2 | **Deferred** — hydrated working sessions never fire completion, dismissed completions never retire (100-entry cap), lookup rejects >64 KiB transcripts, explicit permission request removed; packaged U3 untested; W3 mutation evidence invalid. WIP `61d4c171`. |
| #1582 transcript reducer (`swarm/issue-1582` + `-evidence`) | salvageable | 2/2 | **Deferred** — reducer is unwired (store.tsx snapshot guard rejects captured shapes), numeric-row ordering, alias revision accounting, running child tasks marked terminal. 33/33 reducer unit pass. WIP `f28f2f1b` / `bbf5c65e`. |
| #1572 model catalog slice A (`sol/1572-api`) | salvageable | 2/2 | **Deferred** — no provider curation, entitlement conflated with availability, custom probe changes origin via `//` path (SSRF), restart drift stuck, post-restart custom readiness failed live. WIP `858f7fc2`. |
| #1468 Gemini deferral S1 (`sol/1468-s1`) | salvageable | 2/2 | **Deferred** — cached null intent can overwrite a newer restriction, omitted-model resolution ignores the default agent, any `/gemini/i` model on a non-google provider is refused, session.get on every prompt. WIP `932f87cc`. |
| #1569 Hermes credentials S0 (`sol/1569-contract`) | docs-only | 1→2 | Repair 2 restored six dropped safeguards (16→22 criteria); independent Astra re-review **FAIL** on coverage (Keychain-link confirmation, atomic/0600 grants + corrupt-file rejection, production/diagnostic non-disclosure, Rhythm ownership of index.md/log.md, preservation of Hermes MEMORY.md/USER.md) and memo mirrors. Cap reached → **not committed**, S1/S3/S5 not branched. WIP `08bd238f` on `sol/1569-contract`. |

## Files (mega)

Integrated commits on `mega/2026-09-18-mobile-electron-hermes` after `e93eac6e` (#1547):

| SHA | Slice | Product files |
|---|---|---|
| `9d225f41` | #1568 | `apps/api_server/src/services/usage_budget_service.ts` (+ tests, live test, contract, run doc) |
| `d1662eee` | #1552 | `apps/web/src/styles.css` (.child-chip) + contract spec + evidence PNG |
| `bcf29c84` | #1576 B1 | `apps/api_server/src/database/migrations.ts`, `models/model_provenance.ts`, `repositories/model_provenance_repository.ts` |
| `ac3faa39` | #1581 | `apps/web/src/components/Shell.tsx`, `apps/web/src/styles.css` (+ spec, 18 evidence PNGs) |
| `810e0b91` | #1559 | `apps/web/src/components/tools/AgentSettingsTool.tsx/.css` (+ contract spec/config, updated bucket-a + ToolWorkspace contract) |
| `0ce3db89` | #1575 | `apps/api_server/src/services/agent_delegation_service.ts`, `controllers/agent_delegation_controller.ts`, `repositories/agent_sessions_repository.ts`, `apps/mcp_server/src/tools/agentDelegation.ts` |
| `adfd5c41` | #1581 hygiene | `apps/web/tests/contract/issue-1581.spec.ts` — evidence capture gated behind `RHYTHM_CAPTURE_EVIDENCE=1` |

Docs commit (this record, project-state, testing-guide note, triage issue) follows.

Preserved untouched in the mega worktree: AJ's pre-existing modified
`docs/ai/runs/2026-09-21-desktop-agents-never-start.md` and the untracked `current-plan-*.md`
and `2026-09-21-*.md` docs.

## Checks

| Check | Command | Result |
|---|---|---|
| Canonical PR gate (16 stages) on `adfd5c41` | `ai-workflow checks --level pr` | 15 ✓ / 1 ✗ — `api_server vitest (serial shared-state gate)` = 6267 passed / 1 failed / 258 skipped (668 files passed, 134 skipped): only `src/security/context_scanner.test.ts › repo self-check … loads clean` fails, blocked by the untracked `docs/ai/current-plan-1569.md` (secrets-dotenv, secrets-credentials-file). Same test 19/19 in a worktree without that file. Triaged **OUT OF SCOPE** → [issue](../issues/2026-09-24-context-scanner-self-check-untracked-plan.md). |
| Web build + default suite (mega) | `npm run build && npx playwright test --workers=1` | build ✓; 486 passed / 1 failed / 86 skipped — failure `tests/splitter.spec.ts:71 › Hermes exposes a bounded separator whose size persists` reproduces 2/2 on a base-web worktree (pre-existing) |
| bucket-a rendered (mega vs base) | `playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts` | mega 11/15, base 10/15; the four remaining failures are identical on both |
| Electron renderer slices (mega) | `npm run test:electron-slices` | 25 passed / 1 skipped across 6 configs |
| #1581 contract (gated evidence) | `RHYTHM_E2E_PORT=4583 RHYTHM_DIST_PORT=4584 npx playwright test tests/contract/issue-1581.spec.ts` | 15/15, 0 tracked files modified |
| #1559 contract | `RHYTHM_ISSUE_1559_CONTRACT=1 playwright test --config tests/contract/issue-1559-playwright.config.ts` | 37/37 |
| #1552 + rail specs (pr1577 worktree) | `playwright test tests/contract/issue-1558-*.spec.ts tests/contract/issue-1552-*.spec.ts tests/agents-add-project.spec.ts tests/sessions.spec.ts` | 22 passed / 1 skipped |
| #1568 focused (worktree + mega) | `vitest run src/services/usage_budget_service.test.ts src/__tests__/issue_844_contract.test.ts` | 32/32; 45/45 combined with 1576 after cherry-pick |
| #1568 live | `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_SANDBOX_API_PORT=6098 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-swarm-1568-coordinator-sandbox vitest run src/__tests__/issue_1568_live.test.ts` | 1/1 ✓ against a dedicated sandbox built from mega (no auth.json; synthetic expired/malformed credentials never leak) |
| #1576 B1 focused (after repair 2) | `vitest run src/__tests__/issue_1576_b1_ledger.test.ts` | 13/13, tsc 0 |
| #1575 focused (after repair 2) | `vitest run src/__tests__/issue_1575_async_delegation_worktree.test.ts src/repositories/agent_sessions_repository.test.ts` | 7/7 + 28/28, tsc 0; MCP forwarding 1/1 |
| #1575 live | `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 … vitest run issue_1575_async_delegation_worktree_live.test.ts` | c6 (non-git → 400 WorktreeNotGitError) ✓; c4 (child reports cwd) timed out after 180 s — no provider credential in the synthetic fixture. `api_server.log` shows the child stream subscribed at `…/opencode/worktree/…` while the manager ran in `/var/folders/…/rhythm-1575-git-*` |
| Sandbox health (coordinator, mega build) | `curl /health`, `curl /opencode/health` | `status ok`; `status ready`, `bridgeLive true` |
| GitNexus | `detect_changes` per slice; `compare` vs `788e7ccc` | all low; `upsertResolvedChildSession` upstream impact HIGH (resume/fork/create) — accepted under AJ's standing approval, covered by the repository suite |
| Stale references | grep `openAiUnavailable`, `compactNav` | 0 hits outside git history |

Not run / manual: packaged Electron renderer smoke (#1552 c6, #1581 c7); #1568 G1/G2; #1575 c4 with a
real provider; #1547 real Google consent + exact PostgreSQL 16; live Postgres bootstrap suite (needs
a local PostgreSQL).

## Notes

- Failure-triage ran once (verification-gate → failure-triage): the single red gate stage is the
  scanner repo self-check reading an untracked local planning doc; returned OUT OF SCOPE with the
  issue above; no product change was made in response.

- Environment incident: `npm ci` in `apps/api_server` of the mega worktree followed its
  `node_modules` symlink and emptied the main checkout's root `node_modules` before failing
  `ENOTDIR`. Both trees were regenerated with `npm ci` (root ≈78 hoisted, api_server ≈110
  with `.bin`), mega now has its own real install; the installed Rhythm desktop candidate
  was unaffected. Memory note recorded.
- Two orphaned Playwright web servers (ports 4173/4174) left by the previous pr1577 run were
  killed at start; one orphaned vite (4581) from this run's own 1581 attempt was killed and
  the spec rerun on 4583/4584.
- Codex inspectors ran with `workspace-write -C <worktree>`; pre/post content hashes of all
  16 worktrees were identical (no mutation).
- Web default suite on mega: 486 passed / 1 failed / 86 skipped. The single failure,
  `tests/splitter.spec.ts:71 › shared Splitter › Hermes exposes a bounded separator whose size
  persists`, fails deterministically (2/2 repeats) on a base-web worktree without any integrated
  web change — pre-existing, not introduced here. Bucket-a rendered suite on mega: 4 failed / 11
  passed; the same four fail on base (base also fails a fifth, `self-improvement-review-live`,
  which passes with #1559).
