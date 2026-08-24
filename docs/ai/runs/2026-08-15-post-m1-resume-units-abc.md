---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: pass
tags: [run, Rhythm, post-m1, parity, orchestration]
---

# Post-M1 resume — baseline re-verified, three parallel units, Phase 1 contract opened

Orchestrator session. Three Codex units dispatched in parallel (A: timing, B: Phase 1 contract,
C: parity Flutter reference). Nothing committed.

## Dispatch path changed

The recorded recipe `codex exec --sandbox danger-full-access` is now refused by the Claude Code
permission classifier. Working substitute, probe-verified (`net=ok bind=ok write=ok`):

```bash
codex exec --model gpt-5.6-sol --skip-git-repo-check \
  --sandbox workspace-write -c sandbox_workspace_write.network_access=true "<prompt>" < /dev/null
```

**New constraint discovered by Unit B: Playwright cannot launch Chromium under `workspace-write`**
(Mach rendezvous permission denial, then SIGABRT). Codex units can author Playwright specs but the
orchestrator must execute them. This is now a standing division of labour for the program.

## Baseline

First `verify-all.mjs` run returned FAIL on `slice-7-c6`. Root cause was NOT this program:

```text
not ok 6 - slice-7-c6: packaging is deterministic, gitignored, and leak-free
  slice-7-c6: packaged smoke changed worktrees
  +   'HEAD 89933685e783a69f33b85a2e4ae9a95b098d565c'
  -   'HEAD 47aad933ad03a523403161fc11648f761fc9ccd8'
  worktree /Users/ajhochhalter/.hermes/worktrees/rhythm-self-improvement/latent-c
```

`git worktree list --porcelain` prints every worktree's HEAD sha, and this repository has eight
worktrees driven by separate concurrent agents. The criterion was therefore asserting "nobody
anywhere in this repo committed during the smoke". The self-improvement program committed to
`self-improvement/pg-column-drift` mid-run; that branch moved twice more within twenty minutes
(`47aad933` → `89933685` → `6619e8b9`). Re-running the packaged suite alone: **6/6 pass**.

Escalated to AJ rather than silently adjusted. **AJ approved narrowing it (2026-08-15).** The fix
compares worktree PATHS only, so a leaked worktree still adds a path while unrelated commits are
ignored. Property proved before accepting it:

```text
property ok: HEAD-move ignored = true | leak detected = true
```

The branch check one line above is unaffected by commits and was left alone.

## Unit A — `createWorktree` timing (queued item 1)

**MEASURED, no product change.** Step 1 external differential timing answered the question, so the
planned instrumentation step was not needed.

| Path | Measured |
|---|---|
| engine `POST /experimental/worktree` | 45.5–70.3 ms |
| `POST /agent-sessions` without isolate | 11.5–13.6 ms |
| `POST /agent-sessions` with isolate | 1,528–2,183 ms |
| of which engine `createSession` on the new worktree cwd | 1,459–2,093 ms (94.6–97.4%) |
| MCP status enumeration (the suspected cause) | 2.3–13.1 ms |

**The prior hypothesis is contradicted.** The cost is not raw worktree creation, not generic API
session creation, not the tool-surface estimate, and not MCP enumeration. It is the engine's
`createSession` against a *newly created* worktree directory — 1,459 ms there versus 8–10 ms for the
same call against the established repo cwd.

**Caveat that must not be lost:** this reproduced at the 1.5–2.2 s scale, not the 22.8 s / 61.1 s /
>90 s scale seen under load. A clean cold sample was blocked by the sandbox manager's stale recorded
engine PID and the unit correctly declined to bypass that safety check. So the *stage* is now
attributed; the *load multiplier* is not yet explained.

**Incidental finding, unconfirmed root cause:** hard delete returned `204` on all three isolated
sessions while the API log showed `removeWorktree` returning HTTP 400 — cleanup reporting success
while engine-side worktree removal failed. Worth a follow-up; residue was still zero because the
unit removed the worktrees itself.

## Unit B — Phase 1 acceptance contract (`post-m1-p1-*`)

Contract at `docs/ai/contracts/post-m1-phase-1.json`, 18 sub-criteria. Codex authored; orchestrator
executed the Playwright half. Current disposition:

| Status | Criteria |
|---|---|
| pass (already satisfied by M1 evidence) | c1a, c1c, c2b, c3a, c4a |
| **red** (assertion-level, genuine) | c2a, c2c, c2d, c3b, c4b, c4c, c4d |
| red, **predicate disputed** | c3c, c3d |
| pending (live / packaged / manual) | c1b, c2e, c3e, c4e |

The three Electron reds are real host gaps: no explicit dialog/deep-link policy decision (c4b), no
single-instance lock (c4c), no owned-child registry (c4d).

**Disputed predicate, escalated not fixed:** c3c/c3d drive `#/tools/agent-settings?state=update-error`
and `?state=provider-error`, but `ToolWorkspace.tsx:9` defines
`ToolSurfaceState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly'`.
The tests name states the surface does not define — the same class of trap as the Slice 4
`role='assistant'` literal. Either assert the existing vocabulary, or decide Phase 1 introduces
dedicated update/provider error states. That is a product decision, not a test repair.

The navigation reds were checked against source before being accepted: `nav-<key>`,
`nav-<key>-overflow`, `nav-more`, `aria-current="page"`, `account-button`, and `theme-toggle` all
exist in `apps/web/src/components/Shell.tsx`, so those predicates address the real surface.

## Unit C — parity matrix reads Flutter from `origin/main`

AJ's decision: keep this branch separate from `main`, but build the matrix against the Flutter app on
`main`, because Flutter is the parity REFERENCE and has moved.

`tools/validation/generate-desktop-parity-matrix.mjs` now reads the `flutter` surface from a git ref
(default `origin/main`, override `RHYTHM_PARITY_FLUTTER_REF`), keeps recorded paths as
`apps/desktop_flutter/...`, stamps the resolved SHA into `behaviors.json` and the CLI line, and
**fails loudly on an unresolvable ref** — no silent fallback to the working tree, because that is how
a false parity claim ships. No auto-fetch: a hermetic scan must not depend on the network.

```text
sources=10916 mappings=10916 behaviors=17 review_required=708
flutter_ref=origin/main flutter_sha=9fa2761ed78159f83f56982c03fcd85dc035039a
```

Branch base `9d8c4443` → `origin/main` `9fa2761e` is 17 Flutter files, +1341/−36.

**Finding worth carrying into Phases 7 and 8:** the new Flutter work is live-artifact and
notification behaviour (`live_artifacts_data_source_csp_test.dart`,
`dashboard_artifact_tabs_test.dart`, `issue_1392_approval_push_route_contract_test.dart`,
`*_unified_native_notification_contract_test.dart`), but the delta landed as
`empty-loading-error-offline-forbidden:+5` and `memory-research-…:+1` — not in `live-artifacts` or
`notifications`. Cause is pre-existing and in `categoryFor`: its rules use `\b` word boundaries, and
`_` is a word character, so `notifications/` never matches `\bnotification\b` and
`live_artifacts_…` never matches `\blive artifact\b`. The generator's own stated limitation
("conservative generated default; review before claiming coverage") holds — but it means the corpus
still reports those two behaviours as blind even though `main` now has coverage for them. Not fixed
here: changing `categoryFor` reshuffles the whole corpus and the 689-row baseline.

## Keeping RED out of the M1 regression gate

`apps/web/playwright.config.ts` uses `testDir: './tests'`, so it would have collected Unit B's
deliberately failing Phase 1 specs and turned `web:suite` — and therefore the whole M1 gate — red for
the duration of Phase 1. Caught before the gate finished, by inspecting the config rather than
waiting for the failure.

Fixed by renaming the four Phase 1 specs to a `.redspec.ts` suffix, which the default Playwright
`testMatch` (`**/*.@(spec|test).*`) does not collect, and pointing the two Phase 1 configs and the
contract at the new names. `playwright.config.ts` is covered by `apps/web/SHA256SUMS`, so renaming
the new files avoided a provenance reconciliation that a `testIgnore` edit would have forced.

```text
M1 suite collects post-m1 specs: 0
Phase 1 config collects:         8
```

The Electron red test needed no equivalent change: `verify-all.mjs:91-92` names
`electron-shell.test.mjs` and `electron-unsigned-package.test.mjs` explicitly rather than globbing.
Rename the specs back to `.spec.ts` as each criterion goes green.

## Checks

```text
node tools/validation/generate-desktop-parity-matrix.mjs   behaviors 17, review 708, mappings 10916
node --test tools/validation/test/desktop-parity-matrix.test.mjs      6 pass 0 fail
node --test tools/validation/test/desktop-parity-flutter-ref.test.mjs 2 pass 0 fail
node --test apps/electron/test/electron-unsigned-package.test.mjs     6 pass 0 fail (after the c6 narrowing)
node --test apps/electron/test/post-m1-phase-1-host-policy.test.mjs   0 pass 3 fail (intended RED)
npx playwright test --config tests/post-m1-phase-1-fixture-playwright.config.ts  2 pass 6 fail (intended RED)
```

## Open decisions for AJ

1. c3c/c3d predicate: assert the existing `ToolSurfaceState` vocabulary, or introduce dedicated
   update/provider error states as Phase 1 product work?
2. `categoryFor` word-boundary blindness — leave the corpus as-is and disposition manually, or fix
   the classifier and re-baseline?
3. Follow-up for the `204`-with-failed-`removeWorktree` cleanup mismatch.
