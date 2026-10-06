---
date: 2026-10-06
repo: Rhythm
branch: codex/chat-only-bounded-workflow
pr: 1604
issues: []
status: repairing
tags: [run, Rhythm]
---

## Files

Three test-only updates after the full integration regression gate: API approval lane expectations, MCP exact registration count, and the external-content role graph. Production code is unchanged by this repair.

## Checks

- Frozen C6 source `d0e14d6282817295c07794c1cfdde9531f5b7ff2`, apps tree `674333e91d362324a9ffaa736f475cf4526f0282`: formal opt-in actual API/fork/MCP chat workflow test exited 0, two tests. Idle 19/19 behavioral and 5/5 operational checks; stock-restart 20/20 and 5/5. Both reached the two server-checked criteria, exact two manager ordinals, independent reviewer, and 65 seconds without a third. Both actual SDK inventories were 111. Synthetic external model/ranking responses remain disclosed; this is not provider-semantic or installed native UI proof.
- C6 issue gate exited 0 (4/4). Full PR gate exited 1: API Vitest and MCP Vitest failed; other 20 stages passed. Runner persisted only the final 30 lines of each failed command. Visible seams were approval public DTO expecting private `boundPayloadJson`, old 109-tool constant versus actual 111, and absent classification for the two new signed workflow tools. The API tail markers imply additional failed assertions whose exact output was discarded; do not claim a complete historical failed-test inventory.
- Approval lane repair removes only the private field from public expected rows, preserves exact equality for all prior fields, adds a nonnull invented private payload marker and asserts neither field nor marker is exposed, and re-reads each database row to prove stored fields unchanged.
- Registration repair fixes exact count to 111, explicitly includes both new names, and preserves registrar count/order/duplicate assertions. Role graph adds a dedicated signed finite-workflow classification, with uniqueness/registry/role checks and exact proposal/start routes, trusted native proof, human approval action and continuation boundaries. No role grants or runtime authorization change.
- Focused commands, with PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin: API `./node_modules/.bin/vitest run src/__tests__/issue_1382_approval_lanes.test.ts --reporter=verbose` exited 0, 1/1; MCP `./node_modules/.bin/vitest run src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts --reporter=verbose` exited 0, 9/9. Root reviewed the exact diff and receipt; a separate contract agent found no blockers and made no edits.
- A shared Vitest cache suggested `issue_1186_sandbox_foreground.test.ts` as another failed file. Feature serial reproduction with the approval lane file (`--fileParallelism=false --maxWorkers=1 --reporter=verbose`) exited 0, 8/8. Integration reproduction then exposed three foreground failures: the gate harness set TMPDIR under Documents/Codex, while the stock sandbox correctly permits only /tmp, /private/tmp, or /var/folders. Those three plus the visible lane assertion account for the four API failure markers. This is our gate environment error, not a sandbox product failure. Preserve that RED and rerun with a compliant /private/tmp folder; full repaired-source output capture remains required.
- GitNexus impacts for test symbols returned UNKNOWN (tests excluded). Manual diff scope is three test fixtures/constants/anonymous assertions; no production symbol is edited. `detect_changes --scope all --repo Rhythm-chat-bounded` exited 0 and found no indexed changes; compare against main exited 0, 907 files/9,260 symbols/46 flows, critical risk. Root warned the user. An earlier invocation without the repo selector failed because multiple repositories were indexed; corrected command succeeded.

## Notes

External evidence: `/Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow/gate-three-test-repairs.json`, the exact diff and full focused logs, `formal-live-C6-summary.json`, and `final-gate-c6/`. Archive generated PNGs externally and restore only those owned rewritten paths. Freeze a new source, preserve full per-stage outputs in the external harness, and rerun the required gate from the top before packaging. Package/sign/stable launch, native Dayflow resizing/scrolling, physical phone, and manual merge are separate and remain unrun here.
