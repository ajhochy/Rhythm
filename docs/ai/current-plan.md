# Current Plan — PR #617 bug-fix sprint (2026-05-18)

## Status
Active. **Replaces** the now-superseded M1-M5 parity plan (preserved in git history under `2dde632`-era commits; that plan's six milestones all shipped behind PR #617 / branch `follow-up`, but a full manual smoke against vbeta.18.36 revealed they shipped **broken** — see scoreboard below).

## What happened

PR #617 ("Follow Up") consolidates 13 issues (#601-#611, #614, #615) across install hardening, sessions, archive, WS events, permissions, composer redesign, model picker, OpenRouter curation, slash popover, action row, and VCS chip / branch dropdown. Local verification was reported as green:

- api_server: 499/499 → 503/503 vitest, tsc clean, build clean.
- desktop_flutter: 218/218 test, dart format clean, flutter analyze clean.

A real manual smoke against the packaged DMG (vbeta.18.36, installed at `/Applications/Rhythm.app/`) on 2026-05-18 returned **6 PASS / 1 PARTIAL / 10 FAIL** out of 20 testable items — a 30% pass rate. Auto-tests were green because:

- **Mocks hid the binding bug.** The vitest mock for `opencodeClient.promptAsync` wrapped the spy in an arrow function. Arrow functions have lexical `this`, so the cast-to-alias regression (`const promptFn = opencodeClient.promptAsync as unknown as (...)`) didn't surface in tests — but production code throws `TypeError: Cannot read properties of undefined (reading 'client')` on every send.
- **No e2e coverage for the permission pipeline.** #608 claims `permission.asked → WS → PermissionCard → respond` end-to-end, but no test asserts the pipeline actually fires for a real provider. In production it doesn't fire at all for Claude direct.
- **UI controls weren't verified to reach the SDK.** The thinking-budget / fast-mode toggles render and persist to the DB, but a silent 5th-arg drop in `OpencodeClientService.promptAsync` means they never affect the SDK call. No integration test caught this.
- **No widget tests for the broken features.** File-attach, slash popover, VCS chip — all have zero coverage.

**Decision: keep iterating on the `follow-up` branch; do NOT merge #617 to `main` until ≥80% of the original smoke checklist passes cleanly. The AI workflow's verification gate failed this round — `vitest run` clean is necessary but nowhere near sufficient.**

## Smoke scoreboard (vbeta.18.36)

✅ PASS (6) | ⚠️ PARTIAL (1) | ❌ FAIL (10)

| Section | Result |
|---|---|
| Cmd+Q lifecycle (both ports clear) | ✅ |
| New session + send message (TypeError gone) | ✅ |
| Sessions 1 (soft-close live) | ✅ |
| Sessions 2 (hard-delete live) | ✅ |
| Composer 1 (no agent dropdown, model prompt) | ✅ |
| Composer 2 (picker sectioned + Connect) | ✅ |
| Sessions 3 (archive — active-list live, **archived list not live**) | ⚠️ |
| Permissions 1-4 (#608 pipeline NEVER fires for Claude direct) | ❌ |
| Composer 3 (#604 thinking + fast-mode never reach SDK) | ❌ |
| Composer 4 (#602 file-attach paperclip no-op) | ❌ |
| Composer 5 (#610 slash popover doesn't appear) | ❌ |
| Composer 6 notify (#606 never fires macOS notification) | ❌ |
| Composer 6 timestamp ticker (relative times don't update) | ❌ |
| Composer 7 (#609 curation saves but picker over-filters; duplicate rows) | ❌ |
| VCS 1 (#603 branch dropdown — Dart type cast error + switch fails) | ❌ |
| VCS 2/3 (#607 chip never renders) | ❌ |

## Goal (one sentence)

Drive #617's pass rate from 30% → ≥80% by working the bugs in severity order, re-smoking each cluster on a new DMG, before merging.

## Constraints

- Stay on `follow-up` branch. No new feature work until bugs cleared.
- Every fix must include the test that would have caught the bug in `vitest run` or `flutter test` — no more "mocks pass but production fails."
- For Flutter UI features (file-attach, slash popover, VCS chip, PermissionCard), at least one widget test exercising the user-visible path.
- For server↔SDK plumbing (binding, params, body fields), at least one test that asserts the SDK call is invoked with the expected shape (use spy.mock.calls inspection).
- Re-smoke against a packaged DMG, not `flutter run -d macos`, before claiming each fix is shipped — the bugs in this batch (PATH stripping, NSApp.terminate, body-limit, server.close miss) all manifested only in the packaged build.
- ABI: keep using `vbeta.18.NN` versioning, increment per smoke build.

## Fix clusters (work in this order)

### Cluster A — Safety + visible regressions (highest)

| Issue file | What | Why first |
|---|---|---|
| `fix-permission-pipeline-not-firing-claude-direct.md` | #608 `permission.asked → PermissionCard` chain |  **Safety feature broken.** Claude can run `bash` unprompted in default mode. The whole permission UX is non-functional. |
| `fix-vcs-branch-dropdown-type-cast-and-switch.md` | #603 branch dropdown Dart type cast + HEAD switch | High visibility, blocks VCS 2/3 spot-test. Likely a one-spot parser fix. |
| `fix-vcs-chip-not-rendering-in-session-header.md` | #607 chip never renders | Entire #607 surface invisible. Probably same root cause as VCS 1. |

### Cluster B — Composer behavioral features (medium)

| Issue file | What |
|---|---|
| `fix-thinking-budget-fast-mode-never-applied.md` | #604 — fix `promptAsync` signature to actually accept + forward `thinking` / `fastMode` to the SDK body |
| `fix-composer-file-attach-paperclip-no-op.md` | #602 — wire the paperclip click to the new osascript-based file picker (the `file_picker` plugin was removed earlier) |
| `fix-slash-command-popover-not-firing.md` | #610 — typing `/` opens the popover; arrow / Enter / Escape work |
| `fix-notify-on-completion-not-firing.md` | #606 — covers BOTH the notify-on-completion authorization + the relative-timestamp ticker |

### Cluster C — OpenRouter catalog overhaul (medium, scoped sprint)

| Issue file | What |
|---|---|
| `fix-openrouter-curation-overhaul.md` | #609 — dedup aggregator routes against authed-direct routes; surface ALL curated models in the picker (currently filters to ~6); add bulk-action UI + price/free filter + sane default visibility; fix duplicate `anthropic/claude-sonnet-4.6` row |

### Cluster D — UX / cosmetic (low, batch with Cluster B/C)

| Issue file | What |
|---|---|
| `fix-archived-section-not-updating-live.md` | Insert into archived list cache on `session.updated` WS event when `archivedAt` flips |
| `fix-agent-chat-auto-scroll-steals-focus.md` | Scroll-to-bottom should only fire when user is already pinned near the bottom |
| `fix-agent-kind-mislabels-non-anthropic-openrouter-models.md` | Pill label for DeepSeek / Mistral / Llama OpenRouter routes |
| `fix-google-oauth-paste-back-ui.md` | Render paste input in the Google sign-in dialog instead of "auto-close" placeholder |
| `tweak-default-model-sonnet-over-opus.md` | Reorder `ROUTE_FALLBACKS_BY_AGENT['claude-code']` to put Sonnet first |

### Skipped (environment-dependent)

- Lifecycle 4 (ABI-matched Node fallback). Requires a v24-only test machine. Park for now.

## Validation plan (revised — stricter than the round that failed)

1. `ai-workflow checks --level pr` exit 0 after each issue.
2. **Each fix MUST add a test that would have caught the bug.** No skipping this step. If the bug is "function does X in production but mock doesn't reveal it," fix the mock too — use real implementations in tests where feasible.
3. **Packaged-build smoke is the source of truth.** `vbeta.18.NN+1` rebuild + install over `/Applications/` + manually exercise the specific item before marking a fix complete. `flutter run -d macos` does NOT count for this batch — its PATH and lifecycle differ from the `.app` bundle.
4. After each cluster (A, B, C, D), re-run the entire 20-item smoke checklist. We're targeting ≥80% pass to merge.
5. `dart format --set-exit-if-changed` + `flutter analyze --no-fatal-infos` stay clean.

## Process retrospective notes (for `workflow-retrospective` next time)

Items the workflow should have flagged before any "Closes #608" claim was committed:

- **Mock parity check.** Arrow-function mocks of class methods are a banned pattern when the production method uses `this`. Tests should bind their mocks the same way the production code does.
- **End-to-end coverage matrix.** Every "Closes #XXX" claim needs at minimum one test that exercises the user-visible path (UI → WS → server → SDK and back), not just unit tests of the parts in isolation.
- **Packaged-build smoke before commit, not just before merge.** The PATH-stripping bug + the `server.close()` miss + the binding bug all only manifested in the `.app` bundle. A bot-or-script DMG-build-and-curl loop in the CI would have caught all three.
- **No "all green" claim without a smoke checklist run.** Even a five-item smoke is worth doing before pushing a 13-issue PR.

## Branch / PR strategy

- Stay on `follow-up`. Push fix commits there. Each cluster ships as its own DMG (vbeta.18.37, 38, 39, …) for incremental smoke.
- When the entire 20-item checklist passes ≥16/20 (excluding skipped Lifecycle 4): commit a final "Ready for merge" doc update + push, then merge PR #617 to `main` manually.
- Branch `follow-up` is intentionally not auto-rebased onto `main` during this fix sprint — keep the commit history readable for the retrospective.

## Estimated effort

Per cluster, assuming each fix is the small targeted patch the issue docs suggest:

- Cluster A (3 issues, high severity): **2-3 sessions** — permission pipeline is the unknown; VCS likely a one-day fix.
- Cluster B (4 issues, medium): **2-3 sessions** — file-attach + slash popover are the most UI work.
- Cluster C (1 large issue, OpenRouter overhaul): **2-3 sessions** — bulk-action UI is meaningful work.
- Cluster D (5 issues, low): **1 session, batched** with Cluster B/C.

Total: **roughly 7-10 focused sessions** to get #617 to mergeable state. With re-smoking baked in.
