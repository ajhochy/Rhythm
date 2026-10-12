---
date: 2026-09-29
repo: Rhythm
tags: [decision, Rhythm]
---

# Subagent scoping: regression, edge case, or Groundhog Day?

## 1. The verdict

**Edge case / never worked — not a regression, and not a recurring loss of fix.**

The specific hole found tonight — a **profile-less** `task`-tool child session being
created with **no MCP allowlist at all** — has been present continuously since the
helper was first written, and has never been changed by anyone until tonight.

Decisive evidence (all OBSERVED):

- `childMcpAllowlist` was introduced by `04953d62` (2026-07-10, `fix(#1012)`). Its
  original diff contains `if (!isMcpAllowlist(value)) return undefined`.
- `git log -S "childMcpAllowlist" --all` returns exactly **five** non-documentation
  commits across the whole repo history: `04953d62` and `0c439fb5` (2026-07-10),
  `afd9b011` (2026-07-17), the 2026-09-24/09-28 mega carriers, and tonight's
  `bcce73c4`. None of the intermediate commits altered the fallback.
- `git show origin/main:.../tool/task.ts` and the same on
  `origin/mega/2026-09-18-mobile-electron-hermes` **both still read
  `return undefined` at line 65 today**. Byte-identical between the two branches.
- The asymmetry is real and is the whole story. One week after `04953d62`,
  `afd9b011` (`fix(agents) #1120`) added the *skills* mirror and gave it a parent
  fallback — `return parent.skillAllowlist` — with a comment explicitly reasoning
  about "inherit the PARENT session's scope rather than falling back to all
  skills". That commit **did not touch the MCP helper sitting directly below it in
  the same file.** The two helpers have disagreed on profile-less-child semantics
  for 81 days.

So: nothing regressed. A fix was never lost. The hole is an unhandled branch that
only bites when a `task` child resolves to an agent that is **not** projected into
`~/.config/opencode/agents/` — i.e. the engine's built-in `general` / `explore` /
`scout` subagents, which carry no frontmatter and therefore no `options.mcpAllowlist`.
Every *profiled* Rhythm agent (coding-agent, planning-agent, verification-gate, …)
has always been scoped correctly, which is exactly why this looked like it "worked
fine in the past". It did — for the 95% path.

**Why it surfaced now: honest answer.** I could not find a code change that made
this newly fatal. The honest reading of the record is that an unrestricted
profile-less child has always produced a very large first-turn payload, and that
payload only becomes an *error* rather than an *expense* when it lands on a model
whose context window is smaller than the one the session was sized against. That
is a model-selection condition, not a code condition. Where the evidence is
ambiguous I say so in §5 rather than pick the tidier story.

Two things this is **not**:

- It is **not** the vendored-fork-drift hypothesis. See §5 — there has been exactly
  one subtree import, ever.
- It is **not** the auth-cascade hypothesis, at least not on the available record.
  See §6 — the mechanism is real and unguarded, but no evidence of it firing in the
  failure window exists.

---

## 2. Chronology of scoping fixes

Fourteen distinct occasions on which per-agent MCP/skill scoping was "fixed". All
SHAs and dates OBSERVED via `git log -S`.

| # | Date | Commit | Issue/PR | What it actually changed |
|---|------|--------|----------|--------------------------|
| 1 | 2026-06-25 | `3b9c26ae`, `bfa9f643`, `805ec6c4`, `d760b6bc` | mcp-scope-01…06 | The original build-out: per-session `mcpAllowlist` tool-schema gate in the fork; allowlist expander in api_server; allowlist sent on `createSession`. |
| 2 | 2026-06-27 | `6fce1454`, `40dc8076`, `d46853fe` | #765 | Resolve MCP scope from the **per-turn** agent (not the session's creation-time agent) and push it to the fork session on every ws_gateway turn. |
| 3 | 2026-06-28 | `21f7d78f` | #775 | Enforce per-agent **skill** scoping in the fork — the skills mirror of #765. |
| 4 | 2026-07-02 | `0cc6b578` | #855 | Populate the per-session MCP allowlist *before* tool injection. Until this, scope was stored but never trimmed the surface (~150K tokens). |
| 5 | 2026-07-02 | `45a775bb` | #884 | Cap the MCP tool surface at Gemini's 512-function-declaration limit; introduced the `deferred` catalog concept. |
| 6 | 2026-07-06 | `dd7ca184` | #916, #923 | Scope **fails closed** on empty/malformed config (`[]` had been granting everything); clear stale scope on profile switch. |
| 7 | 2026-07-09 | `7ff686a4`, `9485f57a` | #931 | Surface fail-closed / deny-all scope config errors to the user instead of silently denying. |
| 8 | **2026-07-10** | **`04953d62`** + `0c439fb5` | **#1012** | **`task.ts` gained `childMcpAllowlist`** — subagent sessions spawned by the task tool had been created unscoped. `0c439fb5` added the other half: `opencode_agent_writer` projects the profile's expanded `mcpAllowlist` into the agent `.md` frontmatter so the helper has something to read. **Profile-less fallback shipped as `undefined` and stayed that way.** |
| 9 | 2026-07-11 | `c2110519`, `1b6ccc00` | #1039 | Reload engine config after an agent `.md` write so a promotion takes effect live; guard scheduling of delegation-only profiles. |
| 10 | **2026-07-17** | **`afd9b011`** | **#1120** | **`childSkillAllowlist`** — same defect for skills (all 105 skills, ~89k tokens, injected into every child). Added `return parent.skillAllowlist` as the profile-less fallback. **Did not give `childMcpAllowlist` the same treatment.** This is the fork in the road. |
| 11 | 2026-07-30 | `a07be9e7` | #1282, #1286 | Mobile-created sessions skipped scoping entirely; scope engine sessions at creation, plus `applySelectiveDeferral`. |
| 12 | 2026-08-04 | `610fa19c` | — | Org-optimizer stopped emitting false "tighten scope" proposals from a misread of agent scope. |
| 13 | 2026-08-27 | `675ba3fe` | #1479, #1482, #1488 | Optimizer MCP-scope correctness: per-tool allowlist entries validated against the live catalog (phantom grants had been denying everything). |
| 14 | 2026-09-24 | `bd48b629` (dup `27ae791f`) | #1468, #1573 | Gemini 512-tool guard hardening in `mcp_deferred_tools.ts` / `prompt.ts`, plus a one-line `task.ts` touch. |
| 15 | **2026-09-29** | **`bcce73c4`**, `5cacfca4` | tonight | `childMcpAllowlist` gains `return parent.mcpAllowlist`, closing the 81-day asymmetry. Signature changed to take `parent`. |

Adjacent but distinct (permission scoping, not capability scoping): #1155 /
`38690548` (subagent permission subtrees, 2026-07-24), #1322 / `1c3b943b`
(hardline blocklist reachability, 2026-08-05).

---

## 3. Survival analysis — did any fix get lost?

**No. Not one.** OBSERVED via `git branch -a --contains`:

| Commit | on `origin/main` | on `origin/mega/2026-09-18-…` |
|---|---|---|
| `04953d62` (#1012) | yes | yes |
| `0c439fb5` (#1012 writer half) | yes | yes |
| `afd9b011` (#1120) | yes | yes |
| `21f7d78f` (#775) | yes | yes |
| `45a775bb` (#884) | yes | yes |
| `6fce1454` (#765) | yes | yes |

Two apparent gaps that turn out to be nothing:

- `bd48b629` (2026-09-24, #1573/#1468) is **not** in `origin/main` as a commit — it
  reached main squashed inside `4f915540` ("Rhythm mega … (#1544)", 2026-09-28). I
  verified content equality directly: `git diff origin/main origin/mega -- <all 12
  files of bd48b629>` is **empty**. Nothing was dropped. `27ae791f` is a rebase
  duplicate of the same change and is reachable from nothing.
- `db0954b1` (2026-09-21, auth cascade) is likewise not a commit on main but its
  content is: `git diff origin/main origin/mega -- turn_redispatch.ts
  model_fallback.ts store.tsx` is empty, and main's `turn_redispatch.ts` contains
  10 `errorClass` references.

`0cc6b578` (#855) is reachable from no current branch, but its content shipped —
it was superseded by the 2026-07-02 mega `cbdc321b`, which is on main.

The two leads I was handed do not hold up. **PR #1577 was closed unmerged, but it
is "Transcript child-chip grid fix (#1552) + persisted project-group collapse
(#1558)"** — nothing to do with scoping. The vanished COL-01 worktree likewise maps
to no missing scoping commit; every fix above has a home on main.

**There is no smoking gun here. This is the cleanest survival record I could have
found, and it is itself the answer to "is this Groundhog Day?" — it isn't.**

---

## 4. Regression-test coverage per fix

`apps/opencode_fork/packages/opencode/test/tool/task.test.ts`, `git log --follow`:
`df2dac9a` (07-07) → `04953d62` (07-10) → `afd9b011` (07-17) → `d7a0721f` (07-24) →
`80d1552a` (07-27) → **nothing for 64 days** → `bcce73c4`/`5cacfca4` (09-29).

**The good news, and it is better than I was briefed to expect.** Both task-tool
scoping fixes shipped a **real-boundary integration test** with them, not just unit
tests:

- `04953d62` added an `it.instance` test that declares `mcpAllowlist` in *agent
  config frontmatter*, executes the real `TaskTool`, then asserts on the created
  child session's `mcpAllowlist` — exercising the whole chain
  `frontmatter → ConfigAgent.normalize → agent.options → childMcpAllowlist →
  sessions.create`. Still present on main (line ~640, fixture `rhythm-only`, 513
  tools, `deferred: true`).
- `afd9b011` added the matching `it.instance` for `skillAllowlist` (fixture
  `skill-scoped`), same real chain. Still present on main (line ~690).

So the charge "these tests mock the input they are meant to validate" is **only
half true**, and I want to be precise about which half:

- **Shallow (mocked) — 3 tests.** The `childSkillAllowlist` unit block added by
  `afd9b011` hand-builds `{ options: { skillAllowlist: { skills } } } as unknown as
  Agent.Info`. These assert helper arithmetic only; they would pass unchanged if
  the writer projection broke entirely. Tonight's `childMcpAllowlist` unit block
  (3 more tests) follows the same shape, so the pattern has now propagated.
- **Real-boundary — 2 tests**, one per fix, both surviving. The projection chain is
  genuinely covered for the *profiled* case.

**The actual coverage gap is narrower and sharper than "the tests are fake": in 81
days nobody ever wrote a test for the profile-less branch of either helper.** The
`04953d62` integration test only ever supplies an agent that *has* an allowlist.
`afd9b011` added a mocked test for the skills profile-less branch — which is why
that branch got a correct fallback — and no test at all for the MCP one, which is
why that branch kept returning `undefined`. The missing test and the missing fix
are the same omission.

Tonight's work adds the first tests that drive both helpers with a profile-less
agent (`describe("tool.task child scoping through projected profile frontmatter")`,
lines 809–883), including the built-in-subagent case and the unrestricted-parent
control.

---

## 5. Re-vendor timeline vs fix timeline — hypothesis refuted

OBSERVED. `git log --all --grep="Squashed"` returns exactly three subtree commits
in the entire repository:

- `f0981434` / `66c3a36f` — 2026-06-25, "Merge vendored sst/opencode @ v1.14.49 as
  `apps/opencode_fork` (squashed)".
- `ed458ab1` — 2026-07-24, `apps/mobile/`. Different subtree, unrelated.

**`apps/opencode_fork` has been re-vendored zero times since the initial import.**
The decision doc `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` documents
the `git subtree pull` procedure for future syncs, and that procedure has never been
run. Every subsequent change to the fork (70 commits on main touching
`apps/opencode_fork`) is a local edit.

Local patches are therefore not at risk of being wiped today, and no scoping fix
was ever dropped by a re-vendor. **Kill this lead.** It does, however, mean the
repo carries a 3-month-stale engine and that the *first* re-vendor will be the
dangerous one — see §7.

---

## 6. The auth-cascade lead (`db0954b1`) — mechanism real, evidence absent

Asked to check whether `db0954b1` (2026-09-21, "Hop the fallback cascade on auth
failures") is the proximate trigger. Findings, split by confidence:

**OBSERVED — the mechanism exists and is unguarded.**
`resolveNextFallbackHandoff` (`apps/api_server/src/services/model_fallback.ts:214`)
resolves the hop target's model as `DEFAULT_MODEL_BY_PROVIDER[tier.providerID]`.
For `anthropic` that constant is **`claude-sonnet-4-6`** (line 188), hard-coded.
So *any* cascade hop overwrites the turn's model with the tier default, discarding
the user's selection — including the `team-claude → personal-claude` hop, which
stays on the same provider but still rewrites the model. And `turn_redispatch.ts`
contains **zero** references to `contextWindow` / `context_window` / token limits:
nothing re-checks the composed payload against the new tier's window before
redispatch. If a payload were sized for a 1M-token model and the cascade moved it
to a 200k one, it would overflow, and the code has no way to notice.

**OBSERVED — but no evidence it fired.** Searching `rhythm.db` read-only:

- Messages mentioning `spillover` / `cross_provider`: 56 total, **last one
  2026-08-27**. Zero after `db0954b1` landed on 2026-09-21.
- Messages mentioning `prompt is too long` / `context window` / `exceeds the
  maximum`: 121 total, **last one 2026-08-25**.
- Sessions whose `model_id` is `claude-sonnet-4-6` (the cascade's rewrite target):
  **zero, ever**, across all 7,500+ recorded sessions.
- `formatFallbackExhaustedMessage` text: zero occurrences.

**The caveat that keeps this from being conclusive either way.** The DB's newest
session is `2026-09-28T16:49:44Z` and its newest message is `2026-09-28 16:50:47`.
The failures in question are 2026-09-28 evening / 2026-09-29. **The failing sessions
are not in this database at all**, so the absence of spillover frames is "not
recorded" rather than "did not happen".

**Verdict on the lead: not supported by the record, and I am dropping it as the
explanation** — while flagging the model-rewrite-without-window-recheck as a real,
separate latent defect worth its own issue. It is not the answer to AJ's question;
it is a bug I found while looking for the answer.

Also worth stating plainly, since it bears on "what changed": `claude-sonnet-5`
appears on 392 recorded sessions and `claude-haiku-4-5` on 3,585. If the failing
sessions ran on a 200k-window model where earlier ones ran on a larger one, that
alone explains the timing with no code change whatsoever — and it is consistent
with everything in §1. **I could not prove this from the DB because the relevant
sessions aren't in it.** I am not going to dress an unprovable inference as a
finding.

---

## 7. What would make this stick

The record says fixes *did* stick — so the remedy is not about retention. It is
about the two things that actually failed: **a paired helper drifting apart
unnoticed**, and **a branch nobody ever tested**. Four concrete changes, cheapest
first.

**7.1 Test the profile-less branch, at the real boundary. (Do this one.)**
The `it.instance` integration tests in `task.test.ts` already drive the real chain.
Add exactly one more per helper, with a `subagent_type` that resolves to a config
agent carrying **no** allowlist frontmatter, asserting the child session inherits
the parent's scope. That is ~30 lines in a file that already has the harness. It is
the single test whose absence caused this. Tonight's commits add the unit-level
version; promote it into the `it.instance` block so it exercises
`ConfigAgent.normalize` rather than a hand-built `as unknown as Agent.Info`.

**7.2 Make the two helpers structurally impossible to diverge.**
The root cause is that `childMcpAllowlist` and `childSkillAllowlist` are two
hand-written functions that must agree on one policy ("profile first, then parent,
then undefined") and nothing enforces it. Extract the policy once:

```ts
function childScope<T>(own: unknown, guard: (v: unknown) => v is T, parentScope: T | undefined): T | undefined
```

Both helpers then differ only in their type guard and their post-processing
(Gemini `deferred`). A future third scope kind inherits the fallback for free.
This is a smaller diff than the comment blocks currently explaining the policy
twice.

**7.3 A CI assertion on the writer↔reader contract.**
`0c439fb5` (writer projects into frontmatter) and `04953d62` (task tool reads
frontmatter) are a contract split across two apps — `opencode_agent_writer` in
api_server, `task.ts` in the fork. Nothing fails if one side changes a key name.
Add one test that runs the real writer over a fixture profile and feeds its output
to the real helpers. It is the only test that can catch a projection break, and it
is cheaper than the `it.instance` harness.

**7.4 A re-vendor checklist — before the first re-vendor, not after.**
§5 shows the drift risk is entirely in the future: 70 local commits sit on top of a
subtree that has never been pulled. Add to
`docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` a list of the local
patch sites that a `git subtree pull` must preserve — today that is at minimum
`src/tool/task.ts` (child scoping), `src/session/prompt.ts` +
`src/session/mcp_deferred_tools.ts` (schema gate, Gemini cap), and
`src/session/*` skill filtering — each with the test that proves it. Whoever runs
the first pull will otherwise be reconstructing this list from scratch under
merge-conflict pressure.

**What I am deliberately not recommending.** A branch-containment CI gate. The
survival data in §3 says fixes have never been lost to branch churn — every single
one is on main. A gate would be process weight defending against a failure mode
this repo has not had.
