---
date: 2026-08-05
repo: Rhythm
branch: mega/run-2026-08-04
pr: 1319
issues: [1322, 1123]
status: decided — phases 0–5 pending
tags: [decision, plan, Rhythm, delegation]
---

# Delegation migration — make async delegation the cross-profile path

## Goal (product, not security)

Chat with a manager/orchestrator agent **while implementation is running**: ask it
questions, add to the current workstream, or trigger a new one, without waiting for
the child to finish.

The security benefits (roster authorization, approval gating) are real but
secondary. The reason this matters is that **`task` blocks the parent session**, so
today an orchestrator that dispatches work is unreachable until it returns.
`rhythm_delegate_async` was built precisely to fix that and has never been used.

## Evidence (measured 2026-08-05 against the live DB, 35,591 messages with parts)

| tool | calls | sessions |
|---|---|---|
| `task` | 716 | 189 |
| `rhythm_delegate` | 7 | 4 |
| `rhythm_delegate_async` | **0** | 0 |

What `task` is used for:

| purpose | calls | share |
|---|---|---|
| named Rhythm profiles — **cross-profile delegation** | 647 | 90% |
| engine-native `explore`/`general` — parallelism | 63 | 9% |
| unspecified | 6 | 1% |

Why the async path has never been used — it is **unreachable by 47 of 48 profiles**:

| manager | eligible? | blocker |
|---|---|---|
| `workflow-orchestrator` | no | no rhythm MCP in `allowedMcpsJson` |
| `theologian` | no | has rhythm MCP, delegate tools excluded from tool-level allowlist |
| `secretary` | **yes** | — |

Only 3 of 48 profiles are managers at all. So this is a **configuration** gap, not a
missing feature.

The implementation is done and wired: `delegateToAgentAsync`,
`AsyncDelegationCompletionService`, restart recovery in `server.ts`, `onParentIdle`
hooks in `opencode_stream_bridge.ts`, and 7 contract tests (#1123/#1175) covering
dispatch, busy-parent deferral, exactly-once coalescing, restart recovery and
pagination.

### The pivotal constraint

`delegateToAgentAsync` hard-rejects non-interactive callers:

```ts
if (callerSession.isSystem || callerSession.scheduledTaskId !== null ||
    callerSession.category !== 'chat')
  throw AppError.forbidden('async delegation is only available in interactive chat sessions');
```

And both dominant orchestrators split roughly evenly between interactive and headless:

| profile | chat | scheduled + self_improvement (all `is_system=1`) |
|---|---|---|
| `workflow-orchestrator` | 66 | 86 |
| `secretary` | 86 | 67 |

So this migration **cannot** be a blanket `task` → async swap. Headless orchestration
must keep a synchronous path.

## Decision: a three-way split, mapped onto the tools that already exist

| context | tool | why |
|---|---|---|
| interactive manager chat, crossing a profile boundary | `rhythm_delegate_async` | non-blocking — the whole point; parent stays conversational |
| headless/scheduled orchestration, crossing a profile boundary | `rhythm_delegate` | blocking is correct; no human is waiting |
| parallelism **within** a profile | `task` restricted to `explore`/`general` | genuinely different primitive; keep it |

`task` stops being a cross-profile back door. It does not go away.

## Phases

Ordering is load-bearing: **Phase 4 before Phases 1–3 breaks the entire workflow
chain** (647 calls depend on cross-profile `task`).

### Phase 0 — prove the async round-trip works at all (no code)

`secretary` is already eligible. Use it.

1. Open an interactive `secretary` chat.
2. Have it `rhythm_delegate_async` a slow task to a specialist.
3. Assert: returns an ack immediately; **send it a question mid-flight and get an
   answer**; the child result is later pushed into the same session.

Exit criteria: one complete observed round-trip, including the mid-flight question.
This is the highest-value cheapest step — the push-back path has 0 production calls,
so tests are the only evidence it works today.

### Phase 1 — make `workflow-orchestrator` eligible (covers 69% of traffic)

Already `isManager: true` and `sessionSelectable: true`. Needs only:

- `allowedMcpsJson`: add the rhythm server with (at minimum) `rhythm_delegate`,
  `rhythm_delegate_async`.
- `allowedDelegatesJson`: populate from the observed graph.

Observed roster for `workflow-orchestrator` (445 calls):
`coding-agent` 212, `verification-gate` 80, `planning-agent` 68, `failure-triage` 26,
`workflow-orchestrator` 19 (self), `project-state-updater` 18, `issue-writer` 8,
`smoke-test-writer` 7, `workflow-retrospective` 3.

Observed roster for `secretary` (109 calls): `workflow-orchestrator` 48,
`config-doctor` 13, `AI-Trend-Researcher` 12, `librarian` 8, `theologian` 7,
`worship-planning` 4, `Theological-Researcher` 4, plus a long tail of 1s.

Exit criteria: a live async dispatch from an orchestrator chat, parent answers a
question while the child runs.

### Phase 2 — teach the agents to use it (the behavioral half)

Config alone will not change behavior: the `workflow-orchestrator` skill currently
tells the agent to dispatch specialists, and `task` is what it reaches for. Without
this phase they keep using `task` even once the async tool is available.

- Update the orchestrator skill's dispatch guidance: in an interactive chat use
  `rhythm_delegate_async`; in headless/scheduled runs use `rhythm_delegate`;
  `task` only for `explore`/`general` fan-out.
- Same edit for `secretary`.
- Per the global skill-sync rule, edit the source of truth, not the synced copies.

### Phase 3 — canonicalize delegate IDs

The observed graph contains non-canonical targets that a strict
`targetAgentConfigId` will reject: `AI Trend Researcher` vs `AI-Trend-Researcher`;
`Config Doctor` / `config-doctor` / `Config-Doctor`; `Graphic-designer` /
`graphic-designer`; and raw UUIDs (`9a2d3e4f-…`, `25a2a14f-…`).

`task` tolerated free-text agent names; `rhythm_delegate` does not. So:

- Canonicalize rosters to real profile ids.
- Validate `allowedDelegatesJson` entries resolve to an existing profile, and fail
  loudly (a dead delegate id currently degrades silently).

### Phase 4 — restrict `task` to native subagents (the enforcement step, LAST)

The mechanism already exists — `task` permissions are per-subagent-name:

```ts
buildTaskDelegatePermissions = (roster) => ({ '*': 'deny', ...roster→allow })
```

and `BUILTIN_OPENCODE_AGENT_IDS` already enumerates the natives.

- Non-managers: project `task: { '*': deny, explore: allow, general: allow }`.
  Currently the projection writes **no** `task` key for non-managers, so the
  engine default `"*": "allow"` grants unrestricted delegation — the inverse of the
  intent, and the direct cause of the `ui-ux-designer` complaint. Note the same code
  block already has an `else` forcing `rhythm_delegate_async: deny`; `task` is
  missing its equivalent.
- Managers: roster **plus** the natives.

Exit criteria: `ui-ux-designer` can no longer spawn `coding-agent`; `explore`/
`general` still work; the workflow chain still runs end to end.

### Phase 5 — the long tail

14 further caller profiles delegate cross-profile at ≤22 calls each
(`coding-agent` 22, `config-doctor` 21, `Theological-Researcher` 14, `fantasy-gm` 5,
`theologian` 4, `creative-media` 4, `ui-ux-designer` 4, `rhythm-setup` 3,
`librarian` 2, `AI-Trend-Researcher` 2, `local` 1, `worship-planning` 1, plus two
UUID-named profiles). Each needs a decision: promote to manager with a roster, or
accept that it loses cross-profile delegation.

## Decisions resolved (AJ, 2026-08-05)

### 1. Self-delegation: DENY — "seems like a waste of tokens"

47 calls, 7.2% of all cross-profile `task` traffic, across 8 profiles:
`workflow-orchestrator` 19, `Org External Discovery` 13, `coding-agent` 9,
`config-doctor` 2, then `worship-planning` / `fantasy-gm` / `librarian` /
`AI-Trend-Researcher` at 1 each.

No roster includes its own profile. `buildTaskDelegatePermissions` should also
exclude the caller's own id even if a roster names it, so a stale roster entry cannot
reintroduce recursion.

Note `Org External Discovery` is **100% self-delegation** (13 of 13), so this
decision alone reduces it to needing nothing at all.

### 2. Confirmed: `ui-ux-designer` → `workflow-orchestrator` → `coding-agent`

AJ confirmed the observed hop. So Phase 4 fixes the complaint by denying the FIRST
hop — `ui-ux-designer` loses `task` cross-profile entirely and must do the design
work itself. No change needed at the orchestrator→coding-agent hop.

This generalizes: 13 tail calls are profiles **escalating up** to
`workflow-orchestrator` (`ui-ux-designer` 3, `creative-media` 3, `rhythm-setup` 3,
`coding-agent` 3, `config-doctor` 1). That is the same "hand it off rather than do
it" reflex. Cutting it is the goal, not collateral damage — AJ can talk to the
orchestrator directly when that is what he wants.

### 3. The tail: promote 1, cut 13

| profile | label | vol | mgr? | disposition |
|---|---|---|---|---|
| `theologian` | Theologian | 4 | **yes** | **PROMOTE** — already a manager; only needs the delegate tools un-excluded + a roster |
| `coding-agent` | Coding Agent | 22 | no | cut — 9 self, 7 `verification-gate`, 3 escalate up; the orchestrator should own that sequencing |
| `config-doctor` | Config Doctor | 21 | no | cut — a diagnostic profile, not a hub |
| `Theological-Researcher` | Theological Researcher | 14 | no | cut — its counterpart `theologian` becomes the manager for this pair |
| `9a2d3e4f-…` | Org External Discovery | 13 | no | cut — 100% self, zero impact |
| `fantasy-gm` | Fantasy GM | 5 | no | cut |
| `creative-media` | Creative Media Agent | 4 | no | cut — escalation only |
| `ui-ux-designer` | UI/UX Designer | 4 | no | cut — this is the reported bug |
| `rhythm-setup` | Rhythm Setup | 3 | no | cut — escalation only |
| `1dd5f2e3-…` | Rhythm Setup Agent v2 | 3 | no | cut — **already disabled**, zero impact |
| `librarian` | Librarian | 2 | no | cut |
| `AI-Trend-Researcher` | AI Trend Researcher | 2 | no | cut |
| `local` | Local | 1 | no | cut |
| `worship-planning` | Worship Planning | 1 | no | cut — self only, zero impact |

Tail impact accounting (99 calls):

- 28 are self-delegation — already denied by decision 1
- 13 are escalation up to the orchestrator — deliberately removed
- 4 are `theologian`'s, preserved by promotion
- **54 genuine peer-to-peer calls are given up**, spread across 12 profiles

Any of the 13 can be promoted later on demand; promotion is now a known 2-field
change (`allowedMcpsJson` + `allowedDelegatesJson`) on an existing manager.

## Final eligible-manager set after migration

| profile | interactive path | headless path | roster source |
|---|---|---|---|
| `workflow-orchestrator` | `rhythm_delegate_async` | `rhythm_delegate` | observed graph, minus self |
| `secretary` | `rhythm_delegate_async` | `rhythm_delegate` | observed graph, minus self |
| `theologian` | `rhythm_delegate_async` | `rhythm_delegate` | `Theological-Researcher`, `librarian`, `research` |

Everything else: `task` limited to `explore` / `general`, no cross-profile delegation.

## Risks

- **Async is interactive-only by a runtime gate.** Do not try to unify the two
  paths; headless orchestration must keep the synchronous one.
- **Phase ordering.** Enforcing Phase 4 early breaks 647 calls' worth of workflow.
- **The push-back path is unexercised in production.** Good test coverage, zero real
  calls. Phase 0 exists solely to de-risk this before anything depends on it.
- **Behavior change on restart.** Projection changes take effect when the app
  restarts, so they land as a batch, not incrementally.
