# Rhythm — Project State

## Focus

Complete the remaining Rhythm issue scope in draft mega PR #1544, including Colony inside Rhythm, shared memory, shared canonical agents/settings, native Hermes execution, and two-way delegation. AJ explicitly chose Hermes itself as the execution engine for shared agents launched there. One final combined smoke; no merge, deployment or release publication.

## Branch and included changes

`mega/2026-09-18-mobile-electron-hermes`, `.mega-wt/integration`, [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544). Earlier timestamp, existing-session prompt, webhook and transcript slices remain. Resumed additions: Engraph ownership `efe77109`, workflow ordering #1500 `b9c6150b`, real-API timestamp harness `13cbacf3`, native-agent plan/coverage `0c186d89`, credential reader foundation `20f9c8da`, vault conflict safety `5416d49e`, Colony resolver `b4b24d56`, grant broker `98550b60`, memory CI compatibility repair `3584d7dc`, Engraph startup proof `4893d12b`, and canonical agent revision checks `1b13bca1`.

## Verification

The resumed 16-stage gate has 15 passing stages and one engine cancellation timeout; exact failed-stage replay passed 396 tests (5 skipped, 1 todo), without proving its cause. Latest integrated Electron suite: 232/232 and typecheck passed. Focused memory: 329/329 and API build passed. Full API after the memory repair initially had one Engraph concurrent-manager identity failure. Exact-identity retry is integrated in `4893d12b`: 62 focused tests and API build passed, then the full API suite passed 6329 tests (264 skipped). This is not an all-green gate claim.

## In progress

- S1 credential reader, S2 grant broker and S5 memory safety are included foundations. S3 clean child environment accepted in companion fork commit `d14e280dbf` at `/private/tmp/hermes-shared-integration`: 22 focused tests and full typecheck pass. Pushed to companion draft PR17; not yet artifact-pinned in Rhythm. Actual main IPC, Accounts UI, shared memory and real owned-child consumption remain unfinished.
- Native session policy at `/private/tmp/hermes-shared-agent-policy`: real gateway → AIAgent loopback harness passed 8 cases and exposed one global path-wildcard denial bypass. Matcher repair underway. Separate process restart, compute-host and provider reasoning bytes remain unverified. Full canonical editing/effective-policy mapping/capability transport/delegation still required.
- Shared-agent API design review rejected a bearer-only bridge and incorrect inherited-policy assumptions. Revision-safe edits on the existing agent-config API are integrated in `1b13bca1` (7 parent contract tests pass; 177 neighboring and 56 route/security tests passed in the candidate). Live API/engine qualification remains pending. No insecure new bridge route is accepted.
- Colony upstream at `/private/tmp/bot-crossing-colony-artifact`: builder and protected private service candidates exist; 11 focused service cases pass after disposal and pagination repairs. Shared standalone state extraction contract underway. Resolver is integrated; artifact pin, private IPC, renderer adapter, real scanner and actual Rhythm tab remain unfinished.
- #1572 direct-provider usability, #1573 semantic memory search and remaining backlog retain open acceptance. The [91-issue coverage](runs/2026-09-24-open-issue-coverage.md) distinguishes 12 formal closing references, 28 partial implementations, 1 unintegrated active candidate, 13 planned and 37 unmapped issues. See [native-agent plan](plans/2026-09-24-native-hermes-shared-agents.md).

## Remaining acceptance and safety

No real credential store or vault was modified. New memory checks are synthetic; live API/Hermes qualification remains. External edits after the final digest check remain a documented race. Native Facilities rendering, physical audio/iOS, provider/account behavior, both architectures and signing/notarization remain separate open gates. The unexplained engine test timeout remains recorded. Preserve unrelated dirty September 21 documents.

## Evidence

Individual September 24 run notes contain commands and limits. Durable evidence: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/`. Continue candidate review/integration and new-head CI; prepare the final combined smoke after the feature work is implemented.
