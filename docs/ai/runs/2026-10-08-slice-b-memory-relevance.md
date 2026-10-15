---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: null
issues: []
status: NEEDS_CONTEXT
tags: [run, Rhythm]
---

# Slice B — automatic memory relevance, continuation, turn receipts

## Scope / exclusions

Assigned B1–B8 only. Reuse memory retrieval, canonical native verification,
untrusted fence, generic Dayflow admission, and existing messages repository.
No new service. SQLite-only additive receipts table and small receipts repository.
No agent_runner.ts, dayflow_* or services/decision/* edits. No installs, commits,
pushes, sandbox commands, app servers, or protected-port operations.
The requested Vitest suite includes its existing ephemeral fake Engraph HTTP
fixture; no actual Engraph/engine/API server was launched. Live verification is
NOT RUN, per the dispatch restrictions, and is not claimed.

This single run note is the required durable workflow receipt. Project-state,
current-plan, and other docs remain untouched (dispatch requested no docs edits).
Concurrent edits were present at entry; preserved. In memory_injection_runner.test.ts
Slice B changed only the PROMPT constant, adding a third content token; its added
Dayflow tests belong to Slice A.

## Phase 0 / RED

Loaded acceptance-contract first; read AGENTS.md, project-state.md and current-plan.md.
Created synthetic-only memory_relevance_admission.test.ts before implementation.
Command (apps/api_server):

`npx vitest run src/__tests__/memory_relevance_admission.test.ts --no-file-parallelism`

RED: Test Files 1 failed (1); Tests 11 failed | 1 passed (12).
Root-cause assertions failed, not just absent-export checks:
- resume/yes called native search once (expected no calls).
- one-token semantic hit injected preference/gardens.md (expected []).
- two-token broad archive injected context/violet-optics.md (expected []).
Initial prior-message fixture also lacked its parent session; added the synthetic
session without weakening FK constraints. Initial receipts checks saw missing table.

## Phase 1 / pre-edit CLI impact

Command for each existing symbol:

`gitnexus impact <symbol> --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/scheduled-dayflow-memory-router-20261008`

| Symbol | Risk | Impacted | Direct | Processes |
| --- | --- | ---: | ---: | ---: |
| buildMemoryPreface | LOW | 14 | 2 | 1 |
| relevanceTokens | LOW | 8 | 2 | 0 |
| scoreMemoryForAutomaticInjection | LOW | 9 | 2 | 0 |
| clearsAutomaticGate | LOW | 9 | 3 | 0 |
| boundedRelevantExcerpt | LOW | 4 | 1 | 0 |
| assembleMemoryPreface | LOW | 5 | 2 | 0 |
| emptyMemoryPreface | LOW | 10 | 4 | 0 |
| buildLexicalMemoryPreface | LOW | 8 | 2 | 0 |
| prepareAutomaticMemoryPreface | LOW | 9 | 3 | 1 |
| AgentSessionMessagesRepository | CRITICAL | 125 | 29 | 2 |
| runMigrations | HIGH | 34 | 14 | 0 |
| MemoryPreface | MEDIUM | 65 | 4 | 0 |
| BuildMemoryPrefaceOptions | MEDIUM | 65 | 4 | 0 |
| getRelevantMemories | LOW | 8 | 3 | 0 |

buildMemoryPreface callers: _runOnce and prepareAutomaticMemoryPreface; prompt flows
are affected. prepareAutomaticMemoryPreface reaches WS input, mobile forwarding,
and async delegation. Messages class affects distillFromSession and
createRelayGatewayRouter. Risk warning delivered before edits. Mitigation: only
add a bounded session/role-filtered SELECT method, leaving all writes and existing
methods untouched. Migration is CREATE TABLE/INDEX IF NOT EXISTS only; no Postgres
bootstrap or destructive schema changes. Real in-memory SQLite migrations run in
the contract and many requested regression files.

Test constant QUERY: LOW, zero dependents. PROMPT was ambiguous and selected a
mobile test constant; qualified runner PROMPT lookup returned not found.
expectedPreface lookup returned not found; it was not modified. Anonymous test
assertions are not indexed callable symbols. Used literal fixture inspection for
these bounded test-only changes. Full batch impact output captured by the tool at
`/Users/ajhochhalter/.local/share/opencode/tool-output/tool_11ce36880001zBVKcF887Xqtkv`.

## Phase 2 / files and behavior

- memory_retrieval.ts: exported resolver and conversational filler set; bounded
  current/continuation/abstain semantics, optional priorUserTexts; all lanes use
  displayed canonical sentence/word-aligned excerpt plus atomic citation slug
  tokens, two distinct matches (three for broad notes, no title credit). Rank by
  shared count then native rank. Existing rerank minimum remains an additional
  restriction, never a bypass. Budgets/header/fence preserved; kind/date suffix.
- automatic_memory_preface.ts: newest-first persisted input history, remove one
  current duplicate, fail-open reads; append body-free receipt even for disabled,
  abstained and error calls. Existing latest UI provenance behavior retained for
  successful calls.
- agent_session_messages_repository.ts: listRecentInputTexts, limit <=8, input
  role only, COALESCE(stripped_text, raw_text).
- migrations.ts: additive SQLite agent_memory_turn_receipts + session/id index.
- agent_memory_turn_receipts_repository.ts: explicit nine-field candidate
  projection, <=10 summaries, transactionally retain newest 200/session.
- memory_relevance_admission.test.ts: 14 synthetic contracts, real SQLite and
  canonical temp notes, fake only retrieval/Engraph boundaries.

## Checks / bounded repair history

Required command, run three times total (initial implementation, repair 1, repair 2):

`npx vitest run src/__tests__/memory_relevance_admission.test.ts src/__tests__/memory_ src/services/memory_retrieval src/contract/p0_memory_injection_relevance.test.ts src/__tests__/issue_1573_semantic_degradation.test.ts src/__tests__/core_boundary_admission.test.ts src/__tests__/coordinator_core_followon.test.ts --no-file-parallelism`

Initial: 7 failed | 38 passed files; 32 failed | 418 passed tests (450).
Repair 1: Test Files 45 passed (45); Tests 450 passed (450).
Repair 2 final:

```
Test Files  1 failed | 44 passed (45)
     Tests  1 failed | 451 passed (452)
  Duration  50.73s (transform 2.59s, setup 209ms, import 5.43s, tests 41.53s, environment 2ms)
```

New Slice B contracts: 14/14 pass. Remaining failure is
`issue-0-c13: the fixture corpus separates positives from negatives at threshold 0.60`:
positive collector report ratio is 0.8333333333333334, fixture expects 0.86.
Suffix-normalizing four-letter cups to cup deduplicates that content token.
Did not perform a third repair; handoff required by two-repair bound.

`npx tsc --noEmit -p .` run after each iteration. Final exit 2:

```
src/__tests__/issue_1132_generated_types.typecheck.ts(33,44): error TS2322: Type '"configured"' is not assignable to type '"disabled" | "failed" | "connected" | "needs_auth" | "needs_client_registration"'.
src/services/agent_runner.ts(1320,43): error TS2367: This comparison appears to be unintentional because the types '"disabled" | "failed" | "needs_auth" | "needs_client_registration"' and '"configured"' have no overlap.
src/services/opencode_client_service.ts(5688,11): error TS2367: This comparison appears to be unintentional because the types '"disabled" | "failed" | "connected" | "needs_auth" | "needs_client_registration"' and '"configured"' have no overlap.
```

No remaining diagnostics in Slice B files. These three engine-status diagnostics
were present on the first typecheck and are outside owned scope; do not repair
agent_runner.ts (concurrently owned) or install/update symlinked dependencies.
`git diff --check` passed. No build/dist emission, live test, commit, push or deploy.

## Existing assertion changes (complete inventory)

1. memory_retrieval_rerank.test.ts, on zero-overlap: IDs sem,lex -> lex;
   item sem/.92 -> lex/.7; Teenagers inclusion -> exclusion; chosen sem,lex -> lex.
   Rerank confidence cannot bypass displayed overlap. Shadow chosen similarly
   becomes lex. Hybrid rank-only IDs eg-mine -> []; chosen eg-mine -> empty.
   Owner isolation and rerank minimum assertions unchanged.
2. issue_1573_semantic_degradation.test.ts, case 5: IDs semantic-memory,fts-memory
   -> fts-memory; item ID changes to fts-memory; add rejected-candidate reason.
   Semantic status remains used (native retrieval succeeded, injection rejected).
   Seven collector cup inputs become collector cup storage to exercise retrieval
   rather than newly required B1 abstention. Status/error/timeout assertions unchanged.
3. memory_semantic_e2e.test.ts, E2E-1: one injected item/text/fence/citation/lane
   assertions -> zero items, empty text, rejected semantic candidate. E2E-4: two
   injected items/Teenagers/fence-lane assertions -> zero items, empty text, two
   insufficient_overlap candidates. Neither query shares required displayed tokens.
   Native request-count assertions preserved; explicit reference tests unchanged.
4. memory_injection.test.ts: three exact formatted-text assertions gain (fact).
   Lifecycle/expansion/immutability fixtures add a third query content token so
   those existing assertions still exercise their original behavior (unchanged
   IDs, lifecycle checks, lookup batching and immutability). No-matches/throwing
   inputs changed from q to substantive text so they actually run retrieval.
5. memory_retrieval_semantic.test.ts: RRF-only query becomes substantive;
   prompt-injection fence test input now shares words with the dangerous sentence;
   citation input gains canonical. All security and retrieval-count assertions
   preserved; fixtures previously relied on automatic bypass or short-query recall.
6. memory_injection_index.test.ts: calendar added to facilities query; existing
   index assertions unchanged. memory_injection_runner.test.ts: schedule added
   to shared PROMPT; all runner assertions and concurrent Slice A changes preserved.
7. No assertions changed in memory_provenance.test.ts or
   contract/p0_memory_injection_relevance.test.ts. The latter retains the reported
   failing legacy score expectation pending follow-up.

## Handoff

NEEDS_CONTEXT: B1–B7 new contracts pass; B8 is not green. Next owner should align
the legacy exact score fixture with normalized distinct tokens, rerun the exact
suite, and resolve/qualify the out-of-scope generated engine-status type mismatch.
Maintain the same approved feature scope/exclusions; no renewed scope approval
needed for unchanged Slice B. Do not treat this run as live behavioral verification.
Private evaluation exports: buildMemoryPreface(query, ownerUserId, opts),
resolveAutomaticMemoryQuery(current, priorUserTexts), and
AUTOMATIC_MEMORY_CONVERSATIONAL_FILLERS. Source changed; dist was not rebuilt.
