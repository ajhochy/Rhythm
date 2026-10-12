---
date: 2026-10-09
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

## Files / approved scope

Bounded ORIGINAL acceptance repair, not a new memory product stream. Assigned
worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`.
Only these files were edited/created:

- `apps/api_server/src/services/memory_retrieval.ts`
- `apps/api_server/src/services/automatic_memory_preface.ts`
- `apps/api_server/src/repositories/agent_memory_turn_receipts_repository.ts`
- NEW `apps/api_server/src/__tests__/memory_current_task_preferences.test.ts`
- This sole run receipt. Contract mapping is embedded here rather than adding a
  separate contracts document outside the explicitly owned surface.

Prior router/SDK/Dayflow changes and all old tests were left untouched. No commits,
pushes, installs, servers, real API/model calls, private evaluation/examples,
vault access, or live-user data. All canonical notes in the contract are synthetic
files created under the manager's TMPDIR. No project-state/current-plan update.

### Safety incident (not waived)

The first three Vitest invocations inadvertently ran the existing
`vitest.global-setup.ts:17` teardown, which calls `fs.rmSync` on its own generated
`rhythm-vitest-*` run root. This violates the assignment's no-file-deletion
restriction; it is not an authorized exception. The new contract's separately
created `memory-current-task-*` fixtures have no cleanup and were retained.
No repository source/test files were deleted. After discovering global cleanup,
every subsequent Vitest run used the inline filesystem boundary below: synchronous
rm cleanup is retained/logged; other deletion entry points throw. Global and old
suite fixture roots were then retained, including the observed final run roots
`rhythm-vitest-GG81u4` and `rhythm-vitest-UhAu0z` under manager TMPDIR.

## Phase 0 / contract and RED

Skills loaded first: acceptance-contract, then coding-agent. Read AGENTS,
project-state/current-plan, regression registry, full intended source surface,
existing test harness and relevant caller bodies.

All commands below ran from `apps/api_server` in the assigned worktree unless
otherwise stated. Common environment for every test/typecheck:

```sh
export HOME=/private/tmp/sdmr-grid-sandbox/home
export TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp
export DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db
export DB_CLIENT=sqlite
```

Vitest setup additionally isolates each worker's DB/vault beneath TMPDIR and
sets PORT=0. The new tests use actual in-memory SQLite migrations/repositories,
actual resolver/build/prepare/receipt code and actual canonical file validation;
only the external Engraph ranking boundary is fake. No system-under-test mocks.

```sh
./node_modules/.bin/vitest run src/__tests__/memory_current_task_preferences.test.ts
```

First run: 22 failed / 1 passed, including fixture FK errors because synthetic
owners were not yet seeded. Seeded actual synthetic user rows without disabling
FKs; repeated the same command BEFORE implementation: **15 behavioral failures /
8 passes**, exit 1. Examples: push-211 inherited workout evidence; thanks retrieved;
resume combined bug + workout; draft email lost its style section; receipt reuse
did not consume updated canonical content. Negative archive tests were corrected
to assert no writing-section leakage, rather than blanket-banning otherwise valid
three-token archive references (which the assignment explicitly preserves).

Embedded contract mapping (maintained new file contains 26 cases):

| ID | Acceptance bound to assertions | Status |
|---|---|---|
| A1 | Concrete standalone short commands remain current, no old workout IDs/body | PASS |
| A2 | Pure acknowledgement, including deictic thanks, abstains; resume without prior abstains; no native search | PASS |
| A3 | Nearest bug task only; two-record history cannot lend workout evidence; substantive bounded search | PASS |
| A4 | Exact useful OddsAPI, optics, slide-gradient/centering memory IDs AND content survive genuine continuation | PASS |
| B1 | Persisted receipt history survives empty latest UI provenance; real next canonical read observes updated body; native search not called | PASS |
| B2 | Foreign/deprecated/Dayflow/mismatched-canonical prior IDs excluded; substantive fallback not bare resume | PASS |
| B3 | Receipt/current-task boundary stops at a staging task that admitted nothing | PASS |
| C1 | Draft volunteer email gets coherent style section only, true parent citation/heading/date and exact body-free reason | PASS |
| C2 | Code/staging/workout/football do not inject the writing preference section | PASS |
| C3 | Explicit voice continuation retains active writing task, not old workout | PASS |
| C4 | Applicable current atomic preference outranks native-first derived archive section | PASS |
| C5 | Dayflow-tagged section excluded before output slots; ordinary section survives | PASS |
| C6 | Ambiguous multiple preference sections abstain | PASS |
| D1 | Fences; <=2 items, <=500 excerpt chars, <=1200 serialized chars/300 estimated tokens; body-free fixed reason; exactly 200 retained receipt rows | PASS |
| API | Final-source actual API/engine proof and original private-local evaluation | UNVERIFIED: manager-owned, prohibited in this dispatch |

## Phase 1 / impact and risk review

Attempted MCP `gitnexus_impact` BEFORE edits:
`{target:"buildMemoryPreface", direction:"upstream", repo:"/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008"}`.
Result: repository not found; other indexed repos include Rhythm but cannot
establish this dirty worktree's current graph. **Risk UNKNOWN**, not LOW.
Caller review substituted for an authoritative index; no reindex/install was run.

Exact-string caller search plus body review: AgentRunner directly calls build
with generic/automatic admission, no prior history. WS gateway, mobile proxy,
async-delegation completion and server preparation call prepare; existing owner
and trusted-session boundaries remain caller-owned and unchanged. Explicit
human/MCP reference APIs still do not use automatic preference-section admission.
Internal surface reviewed: resolver/native compaction, native canonical joins,
lexical and rerank gather/assembly, link expansion, receipt append/projection/prune,
recent-input order and the generic Dayflow predicate.

Consequential risks covered by tests: borrowing a second/new task, stale canonical
reuse returning through FTS, rank being mistaken for applicability, archived
body leakage, bypassing owner/lifecycle/generic admission, and budget/fence or
diagnostic regressions. No expanded scope or renewed approval needed.

## Phase 2 / exact implementation delta

- Cue-based short continuation resolves one nearest substantive task; concrete
  issue/deployment commands stay current and pure acknowledgements abstain.
- Continuation searches meaningful substantive-request words, not resume, with
  the automatic native cap reduced 128 -> 80 characters. Existing semantic
  timeout/budget configuration is unchanged.
- Additive `priorMemoryIds?: string[]`; at most 10 unique IDs, fetched from the
  current repository, owner/lifecycle/generic/automatic fences checked, vault
  canonical content revalidated, then current-evidence gate and normal output
  budget applied. No old excerpts are reused. Reuse + fallback share the semantic
  deadline. A rejected canonical ID cannot re-enter via same-turn FTS.
- Receipt helper reads at most eight rows and stops at the nearest current task,
  even when it admitted nothing; unknown legacy query mode stops lookback. No
  latest-session provenance row is used as history. Receipt schema/projection and
  pruning are unchanged.
- Narrow exact Markdown titles: Writing style [profile], Writing preferences,
  Tone and voice. One coherent section only; duplicate titles, nested headings,
  code blocks, too-small or >500-char sections abstain. Task-domain applicability
  is limited to communication/document drafting/revision or explicit writing-voice
  requests, with code/deployment/workout/football exclusions. Dayflow never gets
  this exception. Other references retain their two/three-token gates.
- Citation is the actual parent source plus section descriptor; source/date
  context and untrusted wrapper remain unchanged. Atomic preference priority
  applies only when a derived section is present. Fixed diagnostic reason is
  `applicable_preference_section`; no headings/body/query/token text is persisted.

New exports available for manager private LOCAL evaluation:
`isWritingPreferenceTask(task)` and
`extractWritingPreferenceSection(content): {heading, excerpt} | null`.
Existing `resolveAutomaticMemoryQuery`, `buildMemoryPreface` and
`prepareAutomaticMemoryPreface` remain exported. New repository method:
`recentTaskMemoryIds(sessionId): string[]`.

### Validation commands / observed results

First implementation validation: contract + rerank, **33 passed / 1 failed**.
Actual failure: stale canonical prior was refused by reuse then readmitted by
FTS fallback. First repair excludes those rejected IDs for this turn.
Next combined validation: **90 passed / 3 failed**. Two obsolete old expectations
plus one genuine preservation gap: a named substantive telescope question beginning
"what about" was skipped as a prior. Second repair allows that named prior;
added its exact-content continuation case. Shared tsc initially reported only two
new-test typing errors; corrected mock signature and optional excerpt count check.
Final source review also covered deictic acknowledgements and narrowed explicit
voice matching, without modifying any old assertions.

Preservation boundary used for ALL subsequent test invocations (no new preload file):

```sh
export NODE_OPTIONS='--import=data:text/javascript,import%20fs%20from%20%22node:fs%22;import%7BsyncBuiltinESMExports%7Dfrom%22node:module%22;fs.rmSync=(p)=>console.log(%22PRESERVED_CLEANUP%22,p);fs.unlinkSync=fs.rmdirSync=()=>%7Bthrow%20Error(%22DELETION_DENIED%22)%7D;fs.rm=fs.unlink=fs.rmdir=()=>%7Bthrow%20Error(%22DELETION_DENIED%22)%7D;fs.promises.rm=fs.promises.unlink=fs.promises.rmdir=async()=>%7Bthrow%20Error(%22DELETION_DENIED%22)%7D;syncBuiltinESMExports()'
./node_modules/.bin/vitest run src/__tests__/memory_current_task_preferences.test.ts src/__tests__/memory_relevance_admission.test.ts src/services/memory_retrieval_rerank.test.ts src/__tests__/memory_injection.test.ts src/__tests__/memory_provenance.test.ts src/contract/p0_memory_injection_relevance.test.ts
```

Observed after substantive-question repair: **92 passed / 2 failed**, five files
passed, relevance file failed, exit 1. Old assertions deliberately unchanged:

1. `memory_relevance_admission.test.ts:75-77` expects `query: 'resume'` AND evidence
   including both telescope and unrelated camera tasks. New acceptance requires
   meaningful substantive search and only the nearest task.
2. `memory_relevance_admission.test.ts:127` expects native query exactly `resume`.
   New acceptance forbids searching bare resume when a substantive prior exists.

The test titled "a short message reads as a follow-up only when a substantive prior
exists" now passes unchanged. Its named optics example is valid; the obsolete
blanket-short interpretation in its comments is NOT used as an implementation rule.

Final green command (same common environment + preservation NODE_OPTIONS):

```sh
./node_modules/.bin/vitest run src/__tests__/memory_current_task_preferences.test.ts src/services/memory_retrieval_rerank.test.ts src/__tests__/memory_injection.test.ts src/__tests__/memory_provenance.test.ts src/contract/p0_memory_injection_relevance.test.ts
./node_modules/.bin/tsc --noEmit
git diff --check -- src/services/memory_retrieval.ts src/services/automatic_memory_preface.ts src/repositories/agent_memory_turn_receipts_repository.ts
git diff --no-index --check /dev/null src/__tests__/memory_current_task_preferences.test.ts
```

**79 tests passed / 5 files passed**, exit 0; shared tsc exit 0; tracked and
untracked whitespace checks clean. New contract itself: **26 cases**.
Final-source legacy confirmation, same environment/guard:
`./node_modules/.bin/vitest run src/__tests__/memory_relevance_admission.test.ts`
returned **15 passed / the same 2 obsolete assertions failed**, exit 1. Observed
`PRESERVED_CLEANUP .../rhythm-vitest-NhlcdV`. Final receipt/new-test no-index
whitespace checks and tracked source diff checks were clean.
Existing suites were inspected for cleanup: relevance and injection have synthetic
rmSync teardown, hence the guard; rerank/provenance/P0 have no file-deletion path.
Other semantic/vault suites with deletion behavior or actual servers were NOT RUN
under the dispatch restrictions. No full memory-suite PASS claim.

Exact tracked source diff: **143 insertions / 21 deletions, three files**; new
contract and receipt are additional untracked files. From worktree root:

```sh
git diff -- apps/api_server/src/services/memory_retrieval.ts apps/api_server/src/services/automatic_memory_preface.ts apps/api_server/src/repositories/agent_memory_turn_receipts_repository.ts
git diff --no-index /dev/null apps/api_server/src/__tests__/memory_current_task_preferences.test.ts
```

Final content identities (`git hash-object`, no object writes):

| File | Blob |
|---|---|
| memory_retrieval.ts | 5b5005e085afd13690b1d4792ebefafd112bb70f |
| automatic_memory_preface.ts | 09393cdbac32c3933427bc2d8cb7a098abf419ec |
| agent_memory_turn_receipts_repository.ts | d79c2cbbd5c4661c689e0fe9f80897cb3aedce7f |
| memory_current_task_preferences.test.ts | 79fa05dc4f4ee37b827a618cd2812a0fb6761ae1 |

## Handoff / assumptions

READY_FOR_VERIFICATION for this bounded source repair only. Original acceptance
remains **PARTIAL**: synthetic tests are not final-source actual API/engine proof
and do not establish improved private evaluation metrics. Manager retains that
gate and ownership; no private examples or evaluation artifacts were read.

Conservative ceilings: English cue/task/title vocabulary, exactly one <=500-char
section, nearest substantive prior among six input texts, eight body-free receipt
rows. Larger/ambiguous structures abstain rather than inventing preference snippets.
Canonical changes must already be reflected in the current index; file/index
disagreement fails closed. Unknown transcript/history is safe fallback, not proof
of continuation. No hardcoded real names, note filenames, or projects.

Remaining verification items: final-source actual API proof, manager LOCAL eval,
explicit review/update of the two owned-by-others obsolete assertions, and review
of the recorded unguarded Vitest cleanup safety incident. No commits or pushes.
