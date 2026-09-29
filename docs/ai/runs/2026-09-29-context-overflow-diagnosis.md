---
date: 2026-09-29
repo: Rhythm
branch: mobile/transcript-delta-streaming
pr: 1587
issues: [1571, 1573, 1575, 1586]
status: diagnosed
tags: [run, Rhythm]
---

# Context-overflow diagnosis — every session carries ~261k tokens before the user says anything

## Headline

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
