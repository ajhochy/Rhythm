---
date: 2026-10-06
repo: Rhythm
branch: codex/chat-only-bounded-workflow
pr: null
issues: []
status: repairing
tags: [run, rhythm, chat-bounded-workflow]
---

## Files

Backend/API/MCP implementation for local signed finite workflow proposal, exact human decision, dedicated native wake/start, atomic approval consumption with finite authority CAS, Secretary discovery/prompt scope, and additive current reference selector/version metadata. One optional local SQLite `agent_approvals.bound_payload_json`; no hosted migration or ordinary goal admission change. Existing release wrappers untouched. UI and acceptance contracts are separately owned by root/contract agent.

## Checks

- Fresh GitNexus index at baseline `be1af7df90e499ad8ec0de3ec62cc619543407d2`; impact reviewed for modified production seams. HIGH warnings: migration runner/shared artifact resolver class/public reference search. CRITICAL repository class warning; individual authority-writing method LOW. Specific resolver method LOW. New untracked proposal helper is absent from the baseline graph; its actual call paths are reviewed manually. Shared existing callers remain unchanged except additive internal hook/optional final source proof.
- `cd apps/api_server && PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin ./node_modules/.bin/vitest run src/contract/issue_1392_approval_continuation.test.ts src/__tests__/coordinator_goal_approval_resume.test.ts src/__tests__/coding_workflow_admission.test.ts src/__tests__/memory_retrieval_semantic.test.ts`: 4 files, 134 tests passed.
- Same API command runner, `src/__tests__/workstream_artifact_verifier.test.ts`: 3 passed.
- Same API command runner, `src/__tests__/chat_bounded_workflow_source_guard.test.ts`: 1 passed, actual local index/files verify source growth before sync allocation, index status drift and DB identity drift hold.
- `cd apps/mcp_server && PATH=... ./node_modules/.bin/vitest run src/tools/__tests__/chatBoundedWorkflow.contract.test.ts`: 2 passed. MCP `tsc --noEmit --pretty false` passed.
- Strengthened API contract currently 7 passed; contract owner continues separate negative/revision coverage. Results do not substitute for real live proof.
- New worktree fork build `bun run build --single --skip-install --skip-embed-web-ui` succeeded with native `--version` smoke; API/MCP builds succeeded. Dependency links point only to existing integration dependencies; no install/ci performed. Builds are dirty recon artifacts, not release qualification.

## Notes

Proposals require actual C2 dispatch composition, current owned primary plan root without bypass, fixed lane capability, uniquely captured goal and actual indexed-memory SHA receipt. Canonical approval payload stays server-only; public card contains the complete authored goal/source/version/finite terms/rationale. Identical pending terms reuse the card; revised terms atomically supersede older pending cards while old approved rows remain auditable and cannot fund newer terms.

The expiry allowance starts at proposal creation and the card states its absolute deadline. Approval never extends it. Consumption checks the deadline again after source hashing. A failed authority write rolls back consumption in the same SQLite transaction. A dispatch failure after successful issuance remains consumed and held; no refund, replay ordinal or transparent regrant is inferred.

Two dirty recon attempts held before approval; neither qualifies the behavior. Exact commands use `PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_LIVE_E2E=1 /usr/bin/python3 -B tools/dev/live-chat-bounded-workflow-recon.py --out <external-folder>` from the worktree. First external folder `/Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-recon-20261006T1810Z` returned foreground 409 because the invented model lacked an auth-store entry. Second `/Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-recon-20261006T1805Z` exercised native scoped MCP discovery and held on `references:[], status:unmapped`; the invented rank path incorrectly repeated the memory-root prefix. Both exited 1 with `No pending proposal card from real Secretary MCP`. Their receipts show stock teardown 0, all owned listeners absent, sandbox removed, source and read-only fixtures unchanged, and normal ports unchanged. Only fixture corrections are inferred from these observations; no production auth or path-mapping bypass was added.

The new additive harness uses only invented read-only fixtures and stock sandbox ports 4197/4198/4199 plus transparent observer 4284. Both external model and external rank hint are synthetic; API, native fork, MCP, indexed source and filesystem authority remain real. No Engraph semantic quality, installed desktop chat, physical phone, or release claim is made. Root owns source freeze/commit/integration/final qualification. Packaging/signing/normal-profile launch remain HOLD.

Third dirty recon command used external output `/Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-recon-20261006T1812Z` and exited 0. Receipt `reconReachedFinalStop:true`: actual MCP memory discovery supplied selector/version; proposal created a pending card; actual signed human PATCH queued while Secretary busy; idle delivered a dedicated native wake and exact start. Both real manager jobs succeeded, distinct reviewer terminal membership was recorded, both server criteria verified, continuation replay and 65-second quiescence kept two ordinals, and signed status MCP reported the checks. Teardown: five owned listeners absent, sandbox removed, DB/config/synthetic-auth fixtures unchanged and read-only, source unchanged, normal runtime unchanged, no evidence or cleanup errors. This is `DIRTY_RECON_ONLY`; restart and exact committed-source qualification are still NOT RUN.

An additive opt-in test `src/__tests__/live_chat_bounded_workflow.test.ts` is drafted for separate idle/restart cases with `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_SOURCE_SHA=<root-frozen-SHA>`. It requires committed clean exact source, actual initialized MCP inventory (111 expected), exact consent/consumption/replay, accounting and reviewer checks, and cleanup. The restart variant uses only stock sandbox `restart`, preserving proposal payload and deadline. These new checks were authored from the completed recon observations and remain unqualified until actually run.


Restart recon attempts use the same command with `--restart-approved-wake`. External receipts `chat-bounded-restart-recon-20261006T1818Z` and `...T1822Z` are retained RED: first the fixture adapter tried to rewrite its own read-only invented note, then startup index rebuilding changed the selected memory UUID. The fixture adapter now verifies unchanged existing bytes without rewriting. The rebuild-only repair preserves a UUID solely for one unique exact source/source ID/owner identity, while rebuilding all metadata/bytes/FTS; ambiguous identities, other owners, ID collision and changed versions hold. `src/__tests__/chat_bounded_workflow_index_identity.test.ts` first reproduced the UUID change, then passed 3 actual-SQLite tests. A focused five-file API run covering identity, existing index, semantic memory, signed chat contract and source guard passed 82 tests (the later third collision test also passed). These are local checks, not restart qualification.

The repaired index survived restart in `...T1828Z`, but start remained held: the authority was issued and consumed, workstream blocked `managed_mcp_unavailable`, and no coordinator job existed. No consumed approval was refunded. The subsequent short diagnostic command added `--diagnose-restart-mcp --out /Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-restart-diagnostic-20261006T1847Z`. It captured actual engine `/mcp`, API MCP list, structural config fields/environment hashes, and stock ensure responses through an owned transparent curl wrapper. Before restart Rhythm was `connected`; after the first held start it remained `configured`, with identical config SHA/command/environment hashes. Stock ensure returned `{changed:true,registered:true}` initially and `{changed:false,registered:false}` after restart. This confirms an identical-config runtime registration omission; readiness repair is pending independent review. Every restart receipt above records stock teardown 0, owned listeners absent, source/read-only fixtures unchanged, normal app untouched, and sandbox removed. The diagnostic intentionally exits 1 after capture.

The formal harness now asserts the actual engine `/global/health` version equals `0.0.0-rhythm-<full frozen SHA>`; a prefreeze binary cannot qualify source. Final formal idle/restart runs remain NOT RUN. Root observed GitNexus compare-to-main CRITICAL inherited consolidation scope (889 files/9,097 symbols/46 flows), versus dirty feature-only LOW (28 files/90 symbols/zero flows) before the later index repair; these are snapshots, not a claim of current final counts. Root owns final fresh change detection and source freeze.


Root approved a workflow-only repair after the diagnostic: before claiming an exact current approved workflow continuation, reconnect only its already configured local Rhythm MCP and recheck real coordinator readiness plus the exact candidate/SDK. Absent, disabled, deleted, remote or authentication-held servers stay held; neither config nor deletion intent is changed. Failed connection/readiness leaves consent queued and unconsumed. A dedicated start checks real readiness initially and again before final native/source reproof and atomic issuance. The app's internal readiness callback is bound to its actual current SQLite composition; generic/rejected continuation behavior and existing global ensure/reconnect/readiness methods are unchanged. The shared OpenCode client class's additive method has HIGH impact (20 direct/124 total file dependencies); the modified flush/start/createApp methods had LOW indexed impacts and their actual route/producer paths were manually inspected. API typecheck passed; runtime guard tests 9/9 and ordinary approval/goal/G2 plus new guards 95/95 passed. Restart proof remains pending until independently reviewed and rerun.


The reviewed repair passed dirty stock restart recon with exact command:

```sh
PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_LIVE_E2E=1 /usr/bin/python3 -B tools/dev/live-chat-bounded-workflow-recon.py --restart-approved-wake --out /Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-restart-recon-20261006T1850Z
```

Exit 0; receipt `reconReachedFinalStop:true`, error null. Actual MCP inventory 111; actual indexed search source; busy signed human decision survived stock API/engine restart unchanged; exact native start `started`, replay `held`; two succeeded manager jobs with usage accounting and a completed/notified distinct reviewer; `selected_reference_current` and `reviewed_summary_with_citation` verified with server receipt IDs; 65.22 seconds with two jobs and no third ordinal; signed status observed. Stock down 0, all five owned listeners absent, sandbox removed, source and read-only invented DB/config/auth fixtures unchanged, normal runtime untouched, evidence/cleanup errors empty. This is still `DIRTY_RECON_ONLY`, not committed-source, installed-desktop, physical-device or production qualification. Independent acceptance contract after safe SDK/config fixture update: 17/17 (original assertions retained; configured reconnect positive and needs-auth queued/unconsumed negative added); own runtime helper 9/9, API typecheck/build green.

No further product or harness edits are planned before root's source freeze. The exact committed qualification command will be:

```sh
cd apps/opencode_fork/packages/opencode
OPENCODE_CHANNEL=rhythm OPENCODE_VERSION=0.0.0-rhythm-<full-root-frozen-SHA> bun run build --single --skip-install --skip-embed-web-ui
cd ../../../api_server
PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_SOURCE_SHA=<full-root-frozen-SHA> RHYTHM_CHAT_LIVE_TEST_OUT=/Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow ./node_modules/.bin/vitest run src/__tests__/live_chat_bounded_workflow.test.ts --reporter=verbose
```

Both opt-in cases assert exact clean source before/after and actual running full-SHA engine version; idle/restart final qualification is NOT RUN until that command executes after root commit. Root owns commit, integration, aggregate gate, packaging and signed installed dogfood handoff.
