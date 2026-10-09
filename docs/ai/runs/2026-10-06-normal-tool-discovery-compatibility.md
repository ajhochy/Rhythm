---
date: 2026-10-06
repo: Rhythm
branch: detached 0a784180ef18e39455ca0480f7986e8b273e8b48 (clean installed-baseline copy)
pr: null
issues: []
status: unverified
tags: [run, rhythm, lazy-tool-loading, discovery]
---

# Normal-app tool discovery compatibility (source only)

Plan/review: `normal-tool-discovery-sol-plan.md`, `normal-tool-discovery-astra-review.json`. Scope: the three
approved production files and three existing test files only. Not installed/live proof.

## Defects fixed
- **Raw registered names could not be described.** `mcp_dispatch describe` required the composed key
  (`rhythm_rhythm_get_coordinator_status`); the registered names (`rhythm_get_coordinator_status`,
  `rhythm_search_memory`) were rejected.
- **Natural searches returned nothing** (`coordinator status`, `memory search`): one contiguous substring was required.

## Changes
- `src/mcp/index.ts`: read-only optional accessor `toolOrigins()` → `{key, serverName, toolName}` from the same cached
  definitions, sanitizer and model-visibility rules as `tools()`/`toolClientNames()`; one row per origin so key
  collisions are visible. Not a tool, transport or permission API.
- `src/session/mcp_deferred_tools.ts`: `resolveDeferredMcpDescribeName` (exact canonical wins; otherwise an exact
  registered name resolves only if it selects exactly one key in the FRESH eligible set whose origin is itself
  unambiguous; unknown/multiple/colliding hold; no substring/prefix/suffix/fuzzy/server-preference guess; ambiguity
  lists only permitted keys), `uniqueRawNames`, and token-conjunction `searchDeferredToolCatalog`: lowercase,
  `_`/`-`/punctuation/whitespace as separators, deduplicated words, every word must appear (as partial text) in the
  full canonical name / registered name / server / full description in any order; ranking exact name → exact tokens →
  partial, stable by name; matching runs on the complete eligible catalog BEFORE the 12-result and 180-char bounds;
  queries > 512 UTF-8 bytes or > 32 unique words are rejected; empty query still lists.
- `src/session/prompt.ts`: `readCurrentMcp` (fresh session + real inventory + origins + allowlist/deferred
  eligibility); describe uses the resolver only (canonical id returned as `name`, plus `registeredName`); execute is
  canonical-only; search/describe read eligibility LAST (hosted awaits first) and re-read before exposing an awaited
  schema; the wrapped MCP call re-reads eligibility at the last await before the underlying call (after hooks and the
  native approval ask), so a revocation during the hook window yields no effect. Builtin family unchanged; SDK options,
  `state.withDeferredMcpToolCall`, signing/audit identity, abort and the original validator are unchanged. Dispatcher
  schema/description now tell models to describe by registered name and execute the returned canonical id.

## Red → green (package `apps/opencode_fork/packages/opencode`)
Production files temporarily stashed (`git stash push -- <3 files>`, restored with `git stash pop`):
- `bun test ./src/session/lazy_loading_default.test.ts` → 3 fail / 11 pass (both observed natural queries, separators/
  order/required-words, oversized-query rejection).
- `bun test ./src/session/mcp_deferred_tools.test.ts` → load failure (`resolveDeferredMcpDescribeName` not exported).
- `bun test ./test/session/mcp_allowlist_e2e.test.ts -t "(discovery)"` → Case M, N, P fail (O is a regression guard).
After restore: all green (see checkpoint for exact counts).

## Correction after Sol's HELD review (two actual-harness reds)
- **Inventory-await revocation:** `readCurrentMcp` now rereads the exact session after the inventory/server/origin
  awaits and gates allowlist/deferral/hosted eligibility from that last read.
- **Same-key replacement:** the selected key is bound to a descriptor (actual origin + current description + schema from
  the cached definition); describe exposes it from the same synchronous read and the wrapped executor's last-await check
  requires an equal fresh descriptor, so a replaced origin/schema/description holds and the captured executor never runs.
  Wrapper identity is not used.
- Tests: Sol's two regression bodies applied unchanged from `tool-discovery-sol-provisional-negative.patch`
  (red on the exact first frozen source, then green); owner Case Q guards the schema-only boundary (fails when the
  schema is dropped from the descriptor). Affected 3 files: 52 pass; typecheck exit 0. Logs in task4
  `normal-tool-discovery-correction-*`.
- Limit: connection generation is not available through the read-only accessor and is not used.

## Limits (source-tested only)
- Synthetic engine/MCP harness; the real stdio MCP inventory, API foreground prompt and signing are not exercised.
- Search is retrieval only; no synonyms/semantics. Describe-by-registered-name is exact and unique-only.
- A schema that is not synchronously available is awaited and then eligibility re-read; replacement of an awaited
  schema between the read and return is not separately compared.
- The installed app's independent automatic-memory timeout is unrelated and unaddressed.
- One transient Case N failure (zero dispatch parts) occurred once in a 3-file run and did not recur in 5 later runs;
  cause not diagnosed.
- Builder composition and the normal-app qualification remain open.
