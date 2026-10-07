# Optional calendar/project-session context — Sol verification

**HELD for a narrow optional-source exposure correction and one future-time correction.** Earlier accepted coordinator/core/C3 release remains accepted and is not blocked by this optional slice. Source-only review; no live Google, provider, SDK, installed app, API server or device operation.

## Exact packet and integrity

Patch SHA-256: `93954dfbc68bb066e37969df6fe38483f47d1a367b8c0013ffea71ad747d9327`, nine paths (six application files, one focused test, two receipts). Read Astra's accepted `current-context-calendar-dev-astra-review.md`, Sol plan, owner result, frozen run log and tests. Reconstructed `calendar-dev-context-sol-frozen-copy` from the earlier owned core/C3 copy plus 100 immutable prepared images; verified preimages, apply-check 0, all nine postimages and 94 other prepared pins. No moving owner source was read as authority or edited.

After testing, all original files were restored and all nine postimages/94 unchanged pins rechecked. Permission decision span remains `59b29a996bb2c92d69b538bc2d4709e07417a4c273904047901d3a7ac2d802fc`. Core/C3/lazy/relay/permission implementation and protocol pins outside the six authorized application changes remain intact.

Reviewed adequate owner source-only receipts: new cases **26 passed**, existing context group **35 passed**, relevant core/callback/C3/vertical group **60 passed**, API build exit 0. Exact tool outputs saved in `calendar-dev-context-sol-evidence/owner-selected-results.log`; they were not mechanically rerun. No closed memory/ledger/native/OpenDesign baseline was reopened.

## Reproduced finding 1: final signed-status await retains stale optional observations

Locations in the frozen owned source:

- `services/coordinator_conversation_service.ts:561–572`: assembles context, then awaits `bindingCurrent()` at :562. Afterward only the Secretary's root/profile/native selection is checked. The already assembled calendar/project-session rows are reused in `modelStatusText`.
- `services/coordinator_conversation_service.ts:578`: `modelStatusScopeCurrent` is a root scope proof; it does not inspect optional account/selection, selected cross-project roots, or their current project access/archive state.
- `services/coordinator_conversation_model_status_service.ts:135–139`: the actual signed wrapper awaits `authority.isCurrent` again immediately before response, then invokes only that same root proof. Fixing only the earlier assembly or `modelStatus` await leaves this last signed-wrapper seam open. This last-wrapper conclusion is exact source tracing, not an executed full signed HTTP/native call in this review.

Three new, additive cases use the owner's existing real migrated SQLite + actual repositories/pager/assembler/service fixture. Positive setup first proves the status contains `Dev session` and `Standup`. In the second native binding check, after an actual promise boundary, each case changes only the optional source, retaining the valid Secretary root/native binding:

| New case | Mutation during final service await | Expected final exposure | Actual frozen result |
| --- | --- | --- | --- |
| project archive | Archive `proj-a` | Keep useful core status; withhold affected project-session observations | Available text still contains `Dev session` |
| session owner transfer | Change `proj-session.owner_user_id` from 7 to 8 | Keep core status; no former-owner session label | Available text still contains `Dev session` |
| calendar selection | Set exact owner selection to `[]` | Keep core status; calendar observations withheld/disabled | Available text still contains `Standup` |

Test name: `Sol: signed status withholds stale optional observations after final binding await: %s`. Saved fixture `calendar-dev-context-sol-evidence/coordinator_calendar_project_context.tested.ts:380`, final assertion at :403. Each test explicitly asserts `modelStatusScopeCurrent(...) === true` and requires useful core status to remain available. Failure: `final exposure must not retain an observation invalidated across its awaited native check: expected ... not to contain 'Dev session'` / `'Standup'`.

This is a concrete gap in newly added optional data exposure. It is not cross-project execution authority or an observed live credential/provider leak. The owner tests recheck access inside the adapter and reassemble foreground/callback fingerprints, but their signed-status fixture always returned true without a source change at its last await; those passing tests do not cover this race.

## Reproduced finding 2: future sync time silently becomes observed age zero

`services/coordinator_conversation_runtime_adapters.ts:228,275–281` introduces an unapproved five-minute future skew and clamps negative sync age to zero. A stored last sync one minute in the future is therefore reported as `state:'observed', syncAgeSeconds:0` with an empty mirror. The accepted plan explicitly says invalid/future sync timestamps cannot become a healthy empty observation; it did not approve this new policy exception.

New existing-fixture case `Sol: a future sync timestamp must not become a healthy observed empty mirror` at saved :173 writes `NOW + 60 seconds` and expects `invalid_sync_time`, empty events, null age. It fails with **observed / age 0**. The ordinary invalid/far-future owner cases remain intact. Smallest correction is reject `syncMs > now`, preserving the existing invalid-time state; no new TTL or clock policy. If Astra deliberately wants tolerated future skew, that is an explicit policy change and must be labelled unknown/skewed rather than silently “observed age zero.”

## Exact bounded evidence

Only the missing cases were executed in the isolated copy:

```sh
node node_modules/vitest/vitest.mjs run src/__tests__/coordinator_calendar_project_context.test.ts -t 'Sol:' --maxWorkers=1 --reporter=verbose
```

From `calendar-dev-context-sol-frozen-copy/apps/api_server`: **exit 1, 4 failed / 26 skipped**. The final tested fixture requires core status to remain available; original 26 cases/assertions were untouched. Earlier diagnostic logs (three final-await reds; one future-time red) are also preserved. No implementation was changed to seek green.

- Exact final log: `calendar-dev-context-sol-evidence/exact-final-fixture.log`, SHA `41e487729c478ca645edca4fa1e80e252432379910e200ea4476768f2816f5fd`.
- Test-only patch: `calendar-dev-context-sol-final-exposure-tests.patch`, SHA `f2234e6ba5aa5fc76cd9b0fa70270d0d50169bf59dc2e84b39617ca4126370b6`.
- Original focused test SHA `f2133965fcd7901d7965d94978273436ac05738e5aabe00849c80f038ef83f4b`; tested snapshot SHA `fbc732aaf42a615fe02bd44ea1cbe8a8d8df7aae56408ca456b305134d92012f`.
- Original test restored; frozen code/postimages unchanged. Details: `calendar-dev-context-sol-evidence.json`.

## Smallest same-owner correction, no new framework

1. Preserve a bounded, nonserialized optional dependency proof with the prepared projection. Calendar proof binds exact owner/account id/external id/status/lastSyncedAt/raw selection and the selected mirror observations; project proof binds each selected session's exact owner/project/root/archive/category state plus current project archive/access and actual profile/status fields. Do not expose account identity, credentials, grants, cwd or proof internals in the model response. Use the existing local repository/SQLite reads and the same 8-event/12-root bounds; no full history scan, provider call or sync.
2. Add a narrow synchronous finalizer/current check in the existing context/service seam. Invoke it after `modelStatus`'s last native check **and after the actual signed wrapper's final `authority.isCurrent` await**. The latter requires a narrow change in the existing `coordinator_conversation_model_status_service.ts`, in addition to the already approved context files. Carry the prepared proof/finalizer only internally with the status result; serialize only the existing response shape. Do not overload goal admission's root proof with calendar availability, or change `startGoal` admission.
3. If optional proof changes or cannot be checked, remove only that source's observations and mark it explicitly changed/withheld with unknown coverage. Keep useful core status and unaffected optional source. Calendar can reuse `changed_during_read`; project projection may add the analogous explicit state if needed. Rebuild the existing bounded JSON rather than editing/cutting text. Keep total unknown, omission counts, external completeness unknown and account binding unproven. The final synchronous check/render must have no subsequent awaited work before response; reassembling before another native await simply moves the race.
4. Reuse the proof at existing foreground/callback final current checks so optional exposure does not become stale during their own last assembler await. Existing semantic fingerprint still excludes the ticking age clock. These checks must inspect current source scope/state, not equate a still-current Secretary root with currently readable other-project data. No queue, timer, retry loop, after-commit framework or new native capability is needed.
5. Remove the future-time grace/clamp exception as above, retaining existing invalid-time behavior and honest local age.
6. Retain these four red cases and owner positives. Add only one focused actual signed-wrapper final-await case using the existing signed-status harness, mutating optional scope after service assembly during its last authority read; assert core status remains available but stale optional bodies disappear. That check is currently missing, not a claim of full real-model/HTTP proof. Then run the four negatives, that wrapper case, the existing status/byte-bound/foreground/callback positives and API build. No reason to rerun 342, prior releases or closed baselines.

## Changed behavior otherwise supported by exact source and owner cases

**PASS:** owner-local mirror reads only; leftover mirror hidden when account absent; missing/error/never-synced/corrupt selection/explicit empty remain distinct. Account and raw preference changes during the mirror read withhold it. In-place reconnect before a read is explicitly unprovable: account binding always unproven and external completeness unknown, even for zero rows. No newly claimed authoritative calendar clear/current state.

**PASS:** timed overlap uses normalized instants; spanning events and exclusive all-day ends/Los Angeles boundaries are covered. Eight events plus lookahead; 1,000-row cap forces `hasMore`. Under this scan cap, ordering is exact over scanned candidates, not a proof of the globally earliest eight across every mirror row. Raw provider sync pagination/completeness remains unknown; hosted calendar becomes `read_failed`.

**PASS at assembly:** two 100-row pager pages/12 selected roots, strict exact owner (NULL/foreign excluded), nonchild/nonsystem/nonarchived current-root exclusion, real nonarchived project plus current injected ACL, honest persisted project-session/profile state, no legacy child counts/body/cwd/grants. Partial/expired selection is truncated/unknown rather than authoritative empty. The pager's internal id snapshot is not bounded SQL. Final exposure race above remains separate.

**PASS:** labels sanitized/clipped, foreground carries source state/coverage only, signed status includes bounded detail with deterministic valid-JSON trimming under 3,800 UTF-8 bytes; oversize fallback preserves both qualifications. Optional failure/size does not join mandatory context qualification or make chat unavailable. Fingerprints include semantic optional content but not ticking sync age; owner tests cover real foreground/callback reassembly changes, with no new tools/grants or cross-project dispatch. Existing mandatory/core access behavior remains unchanged.

## Source/live distinction and disposition

Source acceptance of this optional slice awaits the two narrow corrections. Coherent earlier coordinator source/release is unaffected. Live Google/account completeness, actual model use of the signed status tool and normal installed app observation were not executed and are not inferred from synthetic receipts. Full automatic qualified Dayflow bodies and other original product work remain separate; this slice does not complete or reopen them. No remote issue, new framework, application-source edit or broad verification gate was created.
