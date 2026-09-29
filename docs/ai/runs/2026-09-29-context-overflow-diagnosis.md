---
date: 2026-09-29
repo: Rhythm
branch: mobile/transcript-delta-streaming
pr: 1587
issues: [1571, 1573, 1575, 1586]
status: corrected
tags: [run, Rhythm]
---

# Context-overflow diagnosis — every session carries ~261k tokens before the user says anything

> **SUPERSEDED — see the CORRECTION section at the end of this file.**
> Everything between here and the CORRECTION measured an **UNSCOPED raw-engine
> session** that no real Rhythm agent profile ever runs as. The 261,691 number is
> real but it is not the cost of AJ's agents. It is left in place unedited so the
> record shows what changed.

## Headline (UNSCOPED PATH — NOT REPRESENTATIVE OF REAL AGENT SESSIONS)

**OBSERVED.** A brand-new session, empty database, `agent: "general"`, prompt
`"Say hello in exactly 3 words."` costs **261,691 prompt tokens** — the provider's
own accounting, not an estimate.

```
"tokens":{"total":261691,"input":2,"output":10,
          "cache":{"write":261679,"read":0}}
```

Two tokens of user input. 261,679 tokens of fixed overhead. Any model with a
200,000-token window fails this request 100% of the time, regardless of prompt or
agent — which is exactly the reported symptom.

## Method

The measurement is a captured HTTP request body, not a reading of the code.

1. Ran the engine from source (`bun run --cwd packages/opencode src/index.ts serve`)
   on port 4772, with `XDG_DATA_HOME` redirected to a scratch dir — a **fresh, empty
   session database**, and the shared `auth.json` / `opencode.json` never written.
2. Overrode `provider.anthropic.options.baseURL` to a local sink on 127.0.0.1:4771 via
   `OPENCODE_CONFIG_CONTENT` (merges last, highest precedence). The sink writes the full
   request body to disk and returns 400. Zero model cost.
3. Separately ran the same prompt against the real API to obtain the provider's token
   count. An overflow fails before generation, so this was expected to be free; it was
   not — see "Cost" below.

Artifacts: `caps/req-2.json` (695,537 bytes, the real captured body).

## The breakdown — OBSERVED bytes of the captured request

Total body: **695,537 bytes**.

| Component | Bytes | Share |
|---|---:|---:|
| `tools` (460 definitions) | 525,625 | 75.6% |
| `system` (3 blocks) | 189,542 | 27.3% |
| `messages` (the actual question) | 130 | 0.02% |
| `model` / `max_tokens` / `tool_choice` / `stream` | 42 | ~0% |

(Shares exceed 100% because JSON serialization of each sub-object double-counts
delimiters; the components are reported as serialized independently.)

### Where the 189,542 bytes of system prompt go

| Block | Bytes |
|---|---:|
| [0] "You are Claude Code…" | 57 |
| [1] "You are OpenCode…" + AGENTS.md + GitNexus + **`<available_skills>`** | 179,614 |
| [2] Ponytail mode preamble | 5,299 |

Inside block [1], the `<available_skills>` catalog alone is **154,006 bytes — 85.8%
of the block**. It lists **280 skills**.

### The skills catalog is injected TWICE

**OBSERVED.** The `skill` tool's *description* field is **104,268 bytes**, and all
**280 / 280** skill names from the system catalog appear verbatim inside it. The same
catalog ships in the system prompt and again as a tool description.

```
skill tool total       106,718 bytes
  description          104,268 bytes   <- duplicate catalog
  input_schema             205 bytes   <- the only part that is actually a schema
```

Combined skills cost: **154,006 + 104,268 = 258,274 bytes**, ~37% of the entire
request. Roughly half of that is pure duplication with zero information gain.

### 124 of the 280 skills are drafts

**OBSERVED.** `~/.config/opencode/skills/drafts/` holds 124 directories, and **all 124
appear in the live catalog** (`catalog ∩ drafts = 124`, `drafts NOT in catalog = 0`).
A staging folder inside the managed skills dir is being scanned recursively as if every
draft were a shipping skill. They account for **59,193 bytes** of the system catalog
alone, plus their share of the duplicated tool description.

Individual descriptions are *not* the problem — median 309 bytes, max 1,014, none over
5,000. The cost is sheer count.

### MCP tool surface — 460 tools from 20 servers

| Server | Tools | Bytes |
|---|---:|---:|
| (builtin, incl. `skill` @106,718) | 9 | 136,341 |
| rhythm | 102 | 89,291 |
| comfyui-mcp | 40 | 54,772 |
| nfl | 63 | 33,348 |
| minutes | 29 | 25,568 |
| gitnexus | 13 | 25,066 |
| playwright | 25 | 19,437 |
| blender-mcp | 22 | 18,487 |
| pco-services | 32 | 17,854 |
| open-design | 22 | 16,832 |
| stripe | 9 | 16,006 |
| engraph | 25 | 14,898 |
| pdf-tools | 9 | 14,159 |
| gmail-personal / gmail-work | 38 | 27,870 |
| obsidian | 12 | 6,321 |
| duckduckgo / exa / youtube / openmontage / gemini | 10 | 8,455 |

Every one of these is sent on every request, including a 3-word greeting.

## Hypotheses ruled out — each by measurement, not argument

**Ghost-session / history replay (#1586) — RULED OUT.** `messages` is **130 bytes** on a
session created seconds earlier in a **brand-new empty database**. There is no prior
history, no compaction artifact, no resumed parent. The overhead is present on a
database with zero rows.

**Memory/vault injection (#1571, #1573) — RULED OUT as the dominant component.** The
`AGENT-MEMORY` vault is 1.9 MB / 390 files / **721,533 bytes of markdown** on disk, and
retrieval is lexical-only as #1573 says. But **none of it is in the prompt.** engraph
contributes **25 tool schemas = 14,898 bytes (2.1%)** and nothing else; grep of the
system blocks finds zero vault note content. Retrieval happens through MCP tool *calls*
at runtime, not prompt injection. The prime suspect I was handed is not the cause.

**Tonight's commits (`13624919` and the rest of PR #1587) — RULED OUT.**
`git diff --stat d2796905..HEAD -- apps/opencode_fork/packages/opencode apps/opencode_fork/packages/core`
is **empty**. The engine's prompt-assembly source is bit-identical before and after
tonight. `git diff --name-only d2796905..HEAD | grep -iE "skill|prompt|mcp|system"`
returns **nothing**. Tonight's changes are confined to the SDK spawn path
(`packages/sdk/js/src/{process,server}.ts`), the vendored SDK, mobile code, tests and
docs. None of it can alter what goes into a request. The per-working-directory
`ScopedCache` concern does not apply: the count is 460 tools from one directory, and
the overhead reproduces on a cold engine with one session.

**Curated MCP list / allowlist expander growth — RULED OUT.**
`curated_mcp_servers.ts` last changed **2026-08-04**; `mcp_allowlist_expander.ts` last
changed **2026-08-27**. No recent growth to correlate with tonight.

**`rhythm-session-context` plugin — RULED OUT.** 859 bytes; its only action is
overwriting one argument on one tool call.

**Small-model (haiku, 200k) overflow — RULED OUT.** The `claude-haiku-4-5`
title-generation call was captured: **8,296 bytes, 0 tools**. It does not overflow.

## New vs pre-existing — I was partly wrong, and I cannot fully settle it

I claimed "pre-existing" in PR #1587's description without proof. Here is what the
evidence actually supports, stated honestly in both directions.

**The payload is pre-existing.** `drafts/` was created **2026-07-09**; 113 of its 124
entries were created in July, 7 in August, 4 in September, the last on **2026-09-21** —
eight days before the failure. The MCP config's server list is unchanged since August.
The engine's prompt code is unchanged since before tonight. Nothing in the payload grew
yesterday or tonight.

**But that does not make AJ wrong about the failure being new.** The bisect I was asked
to run cannot distinguish the two, because the payload is identical at both commits by
construction (empty diff). What changed must be the *ceiling*, not the payload:

- `claude-sonnet-5` resolves to **context = 1,000,000** on this machine. My 261,691-token
  request **succeeded** against it.
- `claude-haiku-4-5` and `claude-opus-4-5` resolve to **context = 200,000**.
- The reported errors — 201,231 and 203,941 against a **200,000** maximum — are this same
  fixed payload hitting a 200k-window model.

**UNDETERMINED:** I could not identify which model the failing sessions used. Querying
the live engine DB read-only for `ContextOverflowError` / `prompt is too long` returned
**zero rows** — those sessions are not in `~/.local/share/opencode/opencode.db` (likely a
sandbox engine's own database). So I cannot prove *when* or *why* the routing moved onto a
200k model.

**Verdict:** the ~261k payload is chronic and pre-existing — that part of my claim holds.
The *failure* is plausibly new and I have no evidence against AJ's account; a model or
routing change onto a 200k window would produce exactly this, with the payload untouched.
Calling it "pre-existing" in the PR was an unproven assertion either way, and it should not
have been written as background fact.

## An invalid experiment, reported as invalid

I attempted a controlled "drafts removed" run via a scratch `XDG_CONFIG_HOME` with
symlinked skills. It produced 569,670 bytes vs 695,537. **That number is not usable:**
the scratch config also destroyed skill discovery entirely (`system` collapsed to 249
bytes, catalog 0, skill tool absent) and shifted the MCP set. It measures "no skills and
no instructions", not "no drafts". I am recording it so nobody mistakes it for a
validated 18% win.

## Cost — a real miss

The real-API run was expected to be free, on the stated logic that an overflow fails
before generation. It did not overflow — sonnet-5 has a 1M window here — so it ran to
completion and **cost $0.65** (261,679 cache-write tokens). One 10-token generation.
The number it produced is the most load-bearing figure in this document, but the
prediction that it would be free was wrong.

## Proposed fix — cheapest first

1. **Stop double-shipping the skills catalog** — the `skill` tool's 104,268-byte
   description repeats what the system prompt already contains. Pure duplication,
   ~39k tokens, **zero information loss**. Biggest win per line changed.
2. **Move `drafts/` out of the scanned skills dir** (e.g. `~/.config/opencode/skill-drafts/`)
   — removes 124 of 280 catalog entries, 59,193 bytes of system catalog plus their share
   of the tool description. One `mv`, no code.
3. **Scope MCP servers per agent.** Tools are 75.6% of the payload. A coding agent does
   not need comfyui (40), nfl (63), blender (22), stripe (9), gmail (38) or pco (32) —
   204 tools and ~150,000 bytes that are never relevant to a coding session. The
   allowlist machinery (`expandMcpAllowlist`) already exists; it is not constraining this
   path.

(1) and (2) together remove ~163,000 bytes without touching behaviour. (3) is where the
structural headroom is, and is required for any 200k-window model to be usable at all.

## Not fixed here

This run is diagnosis only. No production code changed.


---

# CORRECTION (2026-09-29, later run) — the 261,691 figure measured a path no agent uses

AJ's objection was right. Everything above was measured on a raw engine session
created with `agent: "general"` and **no `mcpAllowlist` / `skillAllowlist` on the
create body**. That is not how Rhythm runs an agent.

## 1. The real path — OBSERVED (code trace)

Interactive turn (`apps/api_server/src/services/ws_gateway.ts`):

```
handleInputFrame
  scopeAgentId = trustedScopeAgent ?? perTurnAgent ?? agentKind      (~ln 511)
  resolveProfileScope(scopeAgentId)                                  (ln 577)
    -> agent_profile_scope._buildMcpRoleConfig(allowed_mcps_json)
    -> { mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }
  wsSkillNames = JSON.parse(allowedSkillsJson)                       (ln 580-590)
  opencodeClient.createSession(title, cwd, wsMcpRoleConfig, wsSkillNames, providerId, ...)
    (opencode_client_service.ts ln 1405+)
      expandMcpAllowlist(mcpRoleConfig)      -> { servers[], tools[] }
      applySelectiveDeferral(..., FAT_SERVER_TOOL_COUNT=30)
      capMcpAllowlistForProvider(..., providerId)       // google only
      POST /session  body.mcpAllowlist   = { servers, tools }        (ln 1522)
      POST /session  body.skillAllowlist = { skills }                (ln 1541)
  (existing session) updateSessionAllowlist / updateSessionSkillAllowlist (ln 784/800)
```

Engine side (`apps/opencode_fork/packages/opencode/src/session/prompt.ts`):

- `filterMcpToolsByAllowlist(Object.keys(mcpToolsAll), keyToServer, session.mcpAllowlist)` (ln 660)
  — decides which MCP tool schemas enter `tools[]`.
- `sys.skills(agent, session.skillAllowlist)` (ln 1760 / 2200) — filters the
  `<available_skills>` catalog in the system prompt.
- `describeSkill(input.agent, input.skillAllowlist)` (`tool/registry.ts` ln 356)
  — filters the `skill` tool's description.

Both copies of the skills catalog are filtered by the same allowlist, so the
"catalog shipped twice" finding above is real in shape but ~10x smaller in
magnitude on a scoped session.

**The prior test never exercised that path.** It POSTed to the raw engine with no
`mcpAllowlist` and no `skillAllowlist`, so `resolveProfileScope`,
`expandMcpAllowlist`, and every skill-allowlist filter were bypassed entirely.

## 2. Re-measurement through the scoped shape — OBSERVED

Same method as above (engine from source, `provider.anthropic.options.baseURL`
pointed at a local sink, dummy `ANTHROPIC_API_KEY`), on ports 4885/4881.
**Zero model calls, zero cost.** Sessions were created with the exact
`mcpAllowlist` / `skillAllowlist` that `resolveProfileScope` → `expandMcpAllowlist`
produces — read verbatim from the projected agent files in
`~/.config/opencode/agents/<id>.md` (`options:` frontmatter), which
`opencode_agent_writer` writes from the same DB columns.

Control first: the unscoped `agent: "general"` case reproduced at **695,417 bytes**
vs the original **695,537** (Δ 120 bytes), so the harness is the same one.

Token estimates use the bytes/token ratio **2.658** established by the original
run's OBSERVED provider accounting on the byte-identical unscoped payload
(695,537 B ↔ 261,691 tok). Marked INFERRED; the margins below are 3x, so
tokenizer precision does not change any conclusion.

| Session shape | MCP servers | Tools | Skills (entries / catalog B) | system B | Total B | Tokens (INFERRED) |
|---|---|---:|---|---:|---:|---:|
| **UNSCOPED raw `general`** (the old number) | all (20) | 460 | 280 / 153,906 | 187,715 | 693,893 | **~261,072** |
| **`workflow-orchestrator`** / gpt-5.6-sol | gitnexus, obsidian, playwright, duckduckgo + 8 named rhythm tools | **73** | 42 / 22,726 | 51,496 | 166,907 | **~62,798** |
| **`coding-agent`** / gpt-5.6-sol | gitnexus | **24** | 7 / 3,125 | 28,486 | 91,313 | **~34,356** |
| **`planning-agent`** / claude-fable-5 | gitnexus + 9 named rhythm tools | **33** | 4 / 1,984 | 26,068 | 98,023 | **~36,880** |
| **`secretary`** / claude-sonnet-5 | gmail-personal, gmail-work, obsidian, pco-services, rhythm | **195** | 10 / 3,419 | 30,697 | 204,479 | **~76,934** |

The `skill` tool description shrinks with the catalog: 104,269 B unscoped →
**16,018 B** on `workflow-orchestrator`, **2,909 B** on `coding-agent`.

## 3. Does a properly-scoped profile fit under 200,000 tokens? — **YES**

`workflow-orchestrator`, the profile that actually orchestrates AJ's sessions,
costs **~62,800 tokens** — 24% of the unscoped figure and **31% of a 200k window**,
leaving ~137k for actual work. The fattest real profile measured (`secretary`,
195 tools) is ~77k. Every profile measured fits with 2.5–5x headroom.

**This is therefore not a chronic payload problem.** It is a specific path that
fails to apply scoping.

## 4. The bypassing path — OBSERVED

`apps/opencode_fork/packages/opencode/src/tool/task.ts`:

```ts
export function childMcpAllowlist(agent: Agent.Info, model): Session.Info["mcpAllowlist"] {
  const value = agent.options.mcpAllowlist
  if (!isMcpAllowlist(value)) return undefined        // <-- UNRESTRICTED
  ...
}

export function childSkillAllowlist(agent: Agent.Info, parent: Session.Info) {
  const value = agent.options.skillAllowlist
  if (isSkillAllowlist(value)) return { skills: [...value.skills] }
  return parent.skillAllowlist                        // <-- falls back to parent
}
```

`childSkillAllowlist` inherits the parent's scope when the target agent declares
none. **`childMcpAllowlist` does not** — it returns `undefined`, which the engine
reads as "no restriction", i.e. every connected server's full tool surface.

Which target agents declare none? The engine built-ins. `~/.config/opencode/agents/`
holds 48 projected profiles and contains **no `general.md`, `explore.md`, `plan.md`,
`build.md` or `compaction.md`** — `opencode_agent_writer` does not project them. Yet
`workflow-orchestrator.md` grants exactly:

```yaml
task:
  "*": deny
  "explore": allow
  "general": allow
  "coding-agent": allow
  "failure-triage": allow
  "issue-writer": allow
```

So **every `explore` or `general` subagent the orchestrator spawns runs with all
460 tools**, while inheriting the parent's 42-skill scope. (Note the DB rows for
`general` and `explore` *do* carry `allowed_mcps_json = ["rhythm"]` — that scope is
never reached on this path either, because the child is built from the projected
agent file, not from the DB.)

Measured that exact shape (no `mcpAllowlist`, parent's `skillAllowlist`) — OBSERVED:

| | Tools | Skills | Total B | Tokens (INFERRED) |
|---|---:|---:|---:|---:|
| `general` subagent under `workflow-orchestrator` | **460** | 42 | 471,896 | **~177,548** |

## 5. Reconciling `ContextOverflowError: 201231 tokens > 200000` — INFERRED, and it fits

The raw-unscoped hypothesis in the task brief does **not** reconcile: a raw
unscoped session on this machine costs ~261k, so it would have errored at ~261,xxx,
not 201,231.

The delegated-child shape does reconcile, arithmetically:

- Fixed floor at turn zero: **~177,548 tokens**.
- Headroom to the 200,000 ceiling: **~22,452 tokens**.
- Reported failures: **201,231** and **203,941** — 1,231 and 3,941 over, and
  **2,710 apart from each other**.

A fixed payload produces one repeatable number. Two different numbers a few
thousand tokens apart, both a hair over the ceiling, is a *growing conversation on
a fixed ~177.5k floor* — one or two tool results in a subagent. That is exactly the
`explore`/`general` child described in §4, on a 200k-window model
(`claude-haiku-4-5`, `claude-opus-4-5`).

**UNDETERMINED:** I could not find the failing sessions. `~/.local/share/opencode/opencode.db`
has 0 rows matching `too long`; `rhythm.db`'s `agent_session_messages` has none
either. The reconciliation above is arithmetic, not a recovered record.

**Can any other real path overflow?** Three ways, in order of likelihood:

1. **The §4 subagent bypass** — ~177.5k floor, ~22k of working room. Prime suspect,
   and consistent with issue #1575 (child sessions inheriting manager state).
2. **Three profiles have no MCP restriction at all** — `codex`, `gemini-cli`,
   `opencode` all have `allowed_mcps_json` NULL/empty, which `resolveProfileScope`
   treats as unrestricted → the full ~261k surface. All three are CLI-runner shims
   with empty system prompts, so they are unlikely to be the failing sessions, but
   they are genuine 200k-window landmines.
3. **History accumulation** on a scoped profile — `workflow-orchestrator` starts at
   ~62.8k, so it needs ~137k of conversation to overflow. Possible in a very long
   session, not in the "brand new session fails immediately" symptom AJ reported.

## 6. What this changes about the proposed fixes

The three fixes proposed above are still correct in direction but are re-ranked:

- **"Scope MCP servers per agent" is already built and already works** on the root
  session path. It was ranked third as missing; it is not missing. It is *skipped*
  for delegated children.
- **The real fix is one function**: make `childMcpAllowlist` fall back to
  `parent.mcpAllowlist` when the target agent declares no scope, exactly as
  `childSkillAllowlist` already does for skills. Same file, ~2 lines.
- The `drafts/` and duplicate-catalog wins are real but shrink by ~10x once
  scoping applies (22,726 B of catalog on `workflow-orchestrator`, not 153,906 B).
  They are worth doing; they are not the overflow.

## Cost of this run

**$0.** No completion was requested from any provider. Every capture came from the
local sink with a dummy API key.

---

# ADDENDUM (2026-09-29, later): child-session scoping — the §6 claim above is SUPERSEDED

> **Superseded:** §6's "The real fix is one function … `childMcpAllowlist` fall back to
> `parent.mcpAllowlist`" was the right *code* for the wrong *reason*. It described
> child scoping as parent inheritance. It is not. Children resolve their own profile.
> The parent fallback applies to profile-less built-ins only. Text above left intact.

## The decisive measurement (OBSERVED)

Loaded the real installed `~/.config/opencode/agents/*.md` through the engine's own
`ConfigAgent.load()` and called `childMcpAllowlist` for a `coding-agent` child
dispatched by a `workflow-orchestrator` parent:

```
parent  workflow-orchestrator mcp: {"servers":["gitnexus","obsidian","playwright","duckduckgo"],
                                    "tools":[8 rhythm_* tools]}   skills: 42
child   coding-agent           mcp: {"servers":["gitnexus"],"tools":[]}  skills: 7
CHILD KEEPS OWN SCOPE: true
explore (profile-less) child mcp: <parent's 4 servers + 8 tools>   (fallback)
```

The child does **not** inherit the parent. It never did — the existing
`isMcpAllowlist(agent.options.mcpAllowlist)` branch already returned the child's own
scope. AJ's requirement ("the coding agent should receive the scoping applied to its
profile") **already holds for every real profile.** Cost: $0, no completion.

## Why it already works (OBSERVED, code-cited)

`apps/api_server/src/services/opencode_agent_writer.ts:778-790` projects each Rhythm
profile to `~/.config/opencode/agents/<id>.md` with
`options.mcpAllowlist = expandProfileMcpAllowlist(config.allowedMcpsJson, ...)` —
**the same expander that scopes a top-level session**. `src/config/agent.ts` declares
`options` as first-class frontmatter and `src/agent/agent.ts:303` merges it into
`item.options`. So a child's allowlist is byte-identical to what the same profile gets
as a root session. 44 of the 48 projected files carry `mcpAllowlist`; 37 carry
`skillAllowlist`; `general` and `explore` are **not** projected (confirmed).

## Every child-creating path

| Path | Resolves child's own scope? | Evidence |
|---|---|---|
| Rhythm async delegation — `agent_delegation_service.ts:305,325` | **Yes.** `resolveProfileScope(targetId)` on the *target* id, then `profileScope.mcpRoleConfig` + `skillNames` into `createSession`. | OBSERVED (read) |
| Engine-native `task` tool — `tool/task.ts` `childMcpAllowlist`/`childSkillAllowlist` | **Yes** for projected profiles (measured above). Profile-less built-ins fall back to the parent. | OBSERVED (measured) |
| Root session — `agent_runner.ts:1335` | N/A (not a child); same expander. | OBSERVED (read) |
| Mobile proxy — `mobile_opencode_proxy.ts:655-692` | N/A (root creation); `resolveProfileScope(profileId)`, strips client-supplied allowlists. | OBSERVED (read) |

## What the orchestrator actually dispatches (OBSERVED, read-only rhythm.db)

`agent_async_delegations` (n=1483) — **100% named Rhythm profiles, zero built-ins**:
coding-agent 605, verification-gate 343, failure-triage 187, ui-ux-designer 94,
planning-agent 72, project-state-updater 63, workflow-retrospective 41, fable 23, …

Engine-native `task` calls parsed from `agent_session_messages.parts_json`, grouped by
the *parent* session's `agent_kind`:

| Parent | Named profile | `general`/`explore` |
|---|---|---|
| workflow-orchestrator | 545 (coding-agent 242, verification-gate 102, failure-triage 52, ui-ux-designer 41, project-state-updater 41, planning-agent 39, …) | 40 |
| planning-agent | — | 127 |
| secretary | ~250 | — |
| fantasy-gm / ui-ux-designer / worship-* / coding-agent | — | 68 / 29 / 27 / 10 |

Repo-wide across all task calls: **419 `general`+`explore` vs ~1046 named profiles.**
So the `undefined` hole was a **real-world** hole (~29% of task dispatches), not a
theoretical one — but it never touched a single real-profile child.

## The fix

Code behavior is unchanged from `bcce73c4` (it was correct). What changed:

1. `src/tool/task.ts` — rewrote both helpers' rationale so it reads *"the child
   resolves its own profile; profile-less built-ins fall back to the parent"*, not
   *"children inherit the parent."* Cites the writer → frontmatter → `agent.options`
   chain and the measured numbers.
2. `test/tool/task.test.ts` — three new tests that load **real projected frontmatter**
   through `ConfigAgent.load()`. The pre-existing three tests hand-built
   `agent.options`, so they never proved the load-bearing link (writer projection →
   frontmatter parse → `options` → helper). Now it is proven end to end.

**Decision — profile-less children get the parent's scope.** They have no profile to
resolve, and the parent's scope is the tightest available bound; "all servers" is not
an option. This is the exception for built-ins, not the rule.

## Mutation proof

| Mutation | Result |
|---|---|
| A: child always inherits parent (`value = undefined`) — AJ's feared wrong shape | **19 pass / 5 fail** |
| B: profile-less child returns `undefined` — the pre-`bcce73c4` hole | **21 pass / 3 fail** |
| Restored | **24 pass / 0 fail** |

## Per-profile scope, child == root

```
workflow-orchestrator  servers=4 explicitTools=8 skills=42
coding-agent           servers=1 explicitTools=0 skills=7
verification-gate      servers=0 explicitTools=9 skills=10
failure-triage         servers=1 explicitTools=0 skills=3
planning-agent         servers=1 explicitTools=9 skills=4
project-state-updater  servers=0 explicitTools=0 skills=2
ui-ux-designer         servers=2 explicitTools=0 skills=6
secretary              servers=5 explicitTools=0 skills=10
```

Leaf tool counts and token sizes were **not** re-measured here — that needs an engine
boot with live MCP connections. INFERRED, but on a strong basis: because the child's
allowlist object is byte-identical to the root's, the prior root-session figures
(coding-agent ~24 tools / ~34.4k; workflow-orchestrator 73 tools / ~62.8k) apply
unchanged to those profiles as children.

Cost of this addendum: **$0.**
