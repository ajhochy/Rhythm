---
date: 2026-09-11
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [1375, 1186, E14, E16, E20, E50]
status: BLOCKED
tags: [run, Rhythm, failure-triage]
---

# Major checkpoint bucket3 — test integration

## Decision / acceptance

**BLOCKED — test-only repairs applied; product-owner work remains.** Do not count
the checkpoint as green or launch another full-suite repair loop. Next full gate
belongs to the manager's next major checkpoint after product repairs. Preserve
exact-review security, strict unexpected-request assertions, modal semantics,
focus recovery, clipboard behavior, and actual persisted profile values.

Started at HEAD `d1be18eda3ba201c1f297f7a953b1a78884ec46f` in
`/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`. Read the
combined checkpoint report and preserved API/web output before reproducing.
Used its fresh `env -i` shell, now documented in `testing-guide.md`; no full
API/web suite, production mutation, provider prompt, GitHub operation, peer
dispatch, commit, push, or manager-owned sandbox lifecycle operation.

## Files owned / repaired

- `apps/api_server/src/__tests__/issue_1375_transcript_share_retention.test.ts`:
  authenticated GET review obtains current mandatory `reviewHash` before POST;
  original retention deadlines, repository fallback, rollback and source-byte
  assertions remain unchanged.
- `apps/api_server/src/__tests__/issue_1186_sandbox_foreground.test.ts`:
  pin fake Node even when caller supplied a Node override; delegate only `-e`
  ABI validation to real Node; fake runtime parses its explicit sandbox argument;
  config has a local command array; fake health emits ready JSON; exit23 fixture
  uses an owned file rather than an env variable stripped by runtime isolation.
- `apps/web/playwright.config.ts`, `package.json`,
  `tests/run-electron-slices.mjs`: exclude config-dependent Electron specs from
  default fixture discovery; explicit dedicated-config manifest retained in
  npm test/list, including E16 live-intercepted and fixture modes.
- `apps/web/tests/contract/issue-2003-tasks.spec.ts`,
  `issue-2004-rhythms.spec.ts`, `issue-2005-projects.spec.ts`,
  `issue-2006-messages.spec.ts`, `issue-2007-facilities.spec.ts`,
  `issue-2008-automations.spec.ts`, `issue-2009-integrations.spec.ts`:
  locate native dialog semantics/modal state on the dialog, not its inner panel.
  No focus/axe checks removed. Project initial-focus assertion remains red.
- `apps/web/tests/contract/issue-1408-1410-1409-inspector.spec.ts`: replace obsolete
  pre-E27 source expectations with rendered fixture-label/no-mutation checks.
  Real terminal behavior remains bound to the dedicated E27 config.
- `apps/web/tests/conversation.spec.ts`: grant browser clipboard permission for
  the single copy journey, not globally fake clipboard success.
- `apps/web/tests/electron-e14-task-planner.spec.ts`: catalog/account GET fixtures.
- `apps/web/tests/electron-e16-agents-safety.spec.ts`: canonical catalogs, known
  Inspector reads, absent ephemeral-child composer, JSON permissions, account
  select, sparse PATCH/readback and opt-in auto-approve expectations.
- `apps/web/tests/electron-e20-session-ordering.spec.ts`: canonical Inspector
  reads; **empty IDs still rejected** in both E16/E20.
- `apps/web/tests/bucket-a-rendered-repair.spec.ts`: populated model catalog and
  sparse profile PATCH followed by reload verify the unedited full asset path
  survives. No screenshot baseline was overwritten.
- `docs/ai/testing-guide.md`, this run note, and local follow-up
  `docs/ai/generated-issues/checkpoint-bucket3-preexisting-browser-failures.md`.

Other visible Electron assembly/E52 product/test/evidence edits belong to their
separate owners. This bucket did not edit those, plans, or project-state. Graph
impact lookups for the test-local helpers could not resolve against the available
Rhythm index (UNKNOWN, not a zero-risk claim); direct inspected callers are local
to each test file. No commit was attempted.

## Checks (package-relative commands, clean shell)

| Command | Observed result |
|---|---|
| API `npm exec -- vitest run src/__tests__/issue_1375_transcript_share_retention.test.ts src/__tests__/issue_1186_sandbox_foreground.test.ts --testNamePattern "authenticated create-share\|preserves plain up"` before edits | Both reproduced: POST400 missing reviewHash; fake-node timeout15000ms |
| API `npm exec -- vitest run src/__tests__/issue_1375_transcript_share_retention.test.ts src/__tests__/issue_1186_sandbox_foreground.test.ts` after repairs | **11 passed**, 14.27s |
| API `npm exec -- vitest run src/__tests__/issue_1186_sandbox_foreground.test.ts --testNamePattern "preserves plain up"` after explicit fake-Node pin | **1 passed**, 6 filtered, 2.77s |
| Web `npm exec -- playwright test --grep "e14-c1\|issue-2003-c12\|issue-2005-c10"` before edits | Reproduced wrong-port blocked navigation, obsolete dialog-role target, actual initial-focus regression |
| Web `npm exec -- playwright test --grep "issue-2003-c12\|issue-2004-c4:\|issue-2004-c12\|issue-2005-c10\|issue-2005-c12\|issue-2006-c6\|issue-2007-c13\|issue-2008-c6\|issue-2009-c1:\|issue-2009-c6\|Tasks is responsive\|copies, reverts\|issue-1409-c"` | **9 repaired dialog tests passed**; remaining focus, clipboard, old terminal and baseline axe failures isolated |
| Web `npm exec -- playwright test --grep "copies, reverts\|issue-1409-c"` after repairs | **3 passed**, 3.5s |
| Web `npm exec -- playwright test --config tests/electron-e14-playwright.config.ts` | **3 passed**, 3.0s |
| Web `npm exec -- playwright test --config tests/electron-e16-playwright.config.ts` | Six reach strict unexpected-request assertion and fail only empty-ID reads; policy initially reached obsolete full-PATCH assertion |
| Web `npm exec -- playwright test --config tests/electron-e16-playwright.config.ts --grep e16-c4-policy` after sparse-PATCH repair | Policy mutation/readback passes, fails only empty-ID reads |
| Web `npm exec -- playwright test --config tests/electron-e20-playwright.config.ts --grep "E20-c2-newest\|E20-c3\|E20-c7"` | All three ordering/paging/search assertions pass, fail only empty-ID reads |
| Web `npm exec -- playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts --grep "bucket-a-rendered-profile\|issue-1477-c1\|auto-promotion"` before bucket edits | Reproduces all four reported failures |
| Web `npm exec -- playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts --grep bucket-a-rendered-profile` after sparse-PATCH/readback repair | **1 passed**, 2.2s |
| Web `npm run test:list` | exit0: default **272 tests/42 files**, no Electron slice specs; bucket13 and all16 dedicated manifest invocations list successfully |
| `git diff --check` | exit0 before final documentation |

The final valid-ID provenance fixtures use the declared object response shape,
not an empty array; neither accepts empty-ID requests. No green E16/E20 claim.
Issue655/Tailscale's seven original failures are **environment**, already qualified
14/14 unchanged by the checkpoint owner; not rerun or modified in this bucket.

## Targeted merge-base comparison

Created a detached baseline at `0bc46a5ece1a937c484c0054493c75b0299eafef` in
`/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/bucket3-base`.
Provisioned only web with `npm ci --offline --ignore-scripts --no-audit --no-fund
--prefix apps/web`; `npm run build` prepared required dist assets. No baseline
full suite. Baseline tree and receipts remain for review, not silently deleted.

- Default `--grep "issue-2003-c12|issue-2005-c10"`: **2 passed** on base.
- Default `--grep "Tasks is responsive|copies, reverts|issue-1409-c"`:
  **3 passed/1 failed**; same Deferred listbox axe failure.
- Bucket config `--grep "bucket-a-rendered-profile|issue-1477-c1|auto-promotion"`:
  **2 passed/2 failed**; same auto-promotion undefined calls and unavailable text.

## Remaining product-owner blockers (not waived as unrelated)

1. **E25B Inspector empty identity:** `LiveProvenance`/`LiveTodos` in
   `apps/web/src/components/Inspector.tsx` run effects before selection exists;
   `src/gateway/inspector.ts` builds `/agent-sessions//memory-provenance` and
   `/agent-sessions//todo`. Strict E16/E20 interceptors deliberately reject these.
   Fix selection/identity gating in product, not via broad fixture allowances.
   Recheck E16 c1–c4 and E20 c2/c3/c7 first.
2. **Project template autofocus:** baseline c10 passes, branch fails. Projects
   `src/pages/projects/index.tsx` focuses `templateNameRef` in its effect, but
   native `FocusDialog.tsx` schedules first-candidate focus in rAF, overriding
   that with the close button. Product should preserve declared initial focus;
   do not retarget the test to whichever control happens to receive it.
3. **Constrained-header golden mismatch:** baseline passes; branch differs by
   21,856 pixels. Inspected expected/actual images: E20 rail controls, honest
   disconnected state, E25B plan/provenance and composer changes alter the whole
   page. Header geometry assertions pass, but reconnect/action controls are
   clipped in the captured branch image. Do not blindly bless a full-page golden;
   product/visual owner must qualify constrained actions before updating evidence.
   Existing screenshot and assertion remain unchanged.

Pre-existing task axe and promotion failures are isolated in the local P2
follow-up above, not a waiver for these branch regressions. E52 and packaging are
separate buckets and were neither repaired nor re-run here.

## Preserved output pointers

- Original combined report has original full-suite log locations.
- Focused dialog/default output: `~/.local/share/opencode/tool-output/tool_0933b6a6b001AKsurydeJMNQXU`.
- Discovery manifest output: `~/.local/share/opencode/tool-output/tool_0933febb40013aJlMJCNW4fYMF`.
- Other short commands/results are in this triage session; Playwright failures
  emit their screenshot/error-context/trace paths. Later commands reuse test-results,
  so the command output and detached baseline are the durable comparison context.
