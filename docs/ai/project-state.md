# Project State

## Current focus

Scheduled-agent autonomy. On 2026-08-04 all 8 of that day's scheduled runs ended
`completed_no_op` or `blocked_on_approval` — none did its job unattended. Eight
defects were diagnosed live against the running agent server on `:4001` and
fixed; the fixes are verified by re-running every enabled task through
`POST /agent-schedules/:id/trigger-now`.

## Active branch / PR

- Branch: `workflow/run-2026-08-04-agent-autonomy` (off `main`)
- PR: not yet opened
- Commits: `0158c878`, `a9140958`, `8181049f`, `0d640b15`
- Deliberately NOT stacked on `workflow/run-2026-08-03-image-generation`
  (draft PR #1304) — unrelated concern. The engine binary is gitignored, so the
  unmerged image_generation build survived every relaunch; verified `:4096` still
  runs the Aug 3 build from `apps/opencode_bin/opencode`.
- Merge remains a manual human action.

## In progress

Final live verification of the 17 enabled scheduled tasks. Latest tally:
**8 success · 6 legitimate no-op · 3 outstanding** (see Risks).

## What changed

1. **Taint → approval deadlock.** `auto_approve_actions` was structurally
   unreachable: any taint forced a security-bound approval, and those hard-coded
   `autoApprove:false` (#1134). Fixed by (a) widening
   `SOURCES_EXEMPT_FROM_APPROVAL_GATE` from 1 → 17 genuinely first-party sources,
   and (b) letting an opted-in profile satisfy the gate on an unattended
   scheduled run (`auto_approve_actions` AND `is_system` AND
   `scheduled_task_id`). One shared predicate,
   `isUnattendedAutoApproveSession`, is used by BOTH the enforcement and the
   request path — they disagreed at first, which is why Org External Discovery
   still blocked twice with the flag set.
2. **All-or-nothing scanner.** 2 of 50 memory rows tripping the `secrets-dotenv`
   pattern withheld all 50. Flagged first-party LIST payloads are now filtered
   per item. (Phrased without the literal token on purpose — this file is itself
   scanned by the `docs/ai/` self-check in `context_scanner.test.ts`, which this
   line originally broke.)
3. **`completed_no_op` on every run.** `MUTATION_TOOL_PATTERN` was `^`-anchored
   and matched 0 of the 40 real tool names; now segment-boundary matched, and
   both signals traverse the delegation tree.
4. **Headless `ask` hang.** Resolution hoisted above the #878 bash gate.
5. **Bash allowlists** contradicting skill allowlists on 7 profiles (librarian
   allowed the `defuddle` skill, denied the binary).
6. **Curated-MCP sidecar duplication** made `ensureCuratedMcps` non-idempotent,
   rewriting `opencode.json` on every boot.
7. **No stale-`running` reaper** for `agent_scheduled_tasks`.
8. **A clean session got 409 on `request_approval`** — found only by live smoke;
   turned a deadlock into a different dead end.

## Risks / known issues

- **`pco-song-usage-sync` fails for a NON-permissions reason.** The agent runs
  `glob {pattern:"**/_pco_sync.py", path:"/Users/ajhochhalter"}` — an unbounded
  glob over the whole home directory. It never returns, consumes the entire 600s
  inactivity window and kills the run. This is the long-standing "glob never
  returns" mystery, now explained. The script is at `Obsidian Vault/Resources/
  worship/Reference/Song Library/_pco_sync.py`; the skill names it only in its
  description, so the agent has to hunt for it. Two fixes, neither taken yet:
  give the skill the absolute path (needs a write to the shared org-skills
  source — a content change, so it needs a human decision), or give `glob` its
  own timeout in the fork (correct structural fix, but needs a fork rebuild that
  would clobber the unmerged image_generation engine — do it after #1304 lands).
- **`Org Self-Optimizer` skips inside a 90s engine cold-start window.** Not a
  defect; just needs >90s between relaunch and trigger.
- **Classifier cannot see through `bash`.** A task mutating only via `bash`
  still reports `completed_no_op` (`ai-trend-research-daily` wrote 9 findings, a
  dashboard and 6 archives that way). Deliberate trade — counting `bash` as a
  mutation would mark every read-only run a success. Real fix needs the command
  or a write-count in telemetry.
- **`auto_approve_actions` is now on for `librarian`, Org Optimizer and Org
  External Discovery.** For those profiles, on scheduled runs only,
  externally-influenced text can reach a protected mutation with no human. Every
  bypass writes an audit row with the taint source. NOT enabled for `secretary`
  (email) — that needs an explicit human decision because `email.send` is a
  protected action.
- Some `rhythm_remember_memory` writes return 400 from the production API; the
  reason was previously hidden by `[object Object]` error rendering (now fixed),
  so the next run should surface it.
- Pre-existing and out of scope: `apps/mobile` checks fail on a missing `eslint`
  and a wrong npm script.

## Test status

- api_server: 467 files pass / 2 fail before the sidecar fix; both failures were
  that sidecar duplication and now pass (26/26 curated-MCP tests).
- mcp_server: 153/153. Typecheck, lint, build clean in both.
- opencode fork: typecheck clean; session suite 383 pass / 0 fail.
- New coverage: classifier (31), unattended auto-approve (10), first-party
  exemption (34), per-item salvage (9), stale-running reaper (11),
  approval-not-required (4), plus 4 added bridge cases.

## Next step

Finish verifying the last outstanding tasks, then decide the
`pco-song-usage-sync` fix (skill path vs. fork glob timeout) and whether
`secretary` gets `auto_approve_actions`. Then open the PR.
