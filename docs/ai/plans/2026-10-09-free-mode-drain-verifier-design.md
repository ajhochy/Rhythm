---
date: 2026-10-09
status: D1-D4 + F3 extraction implemented 2026-10-09 r12 (see ledger final-r12); real-provider qualification not done
tags: [plan, rhythm]
---

# Free Mode: automatic drain (F2) and genuine verifier / privacy preflight (F3) - design

## Honest status of what exists (final-r10/r11)

- F1 hold: implemented, live-proven (desktop REST/WS, scheduled). Mobile: unit only.
- F2 as built is **PARTIAL**: `releaseFreeQueue` removes descriptors Tier 1 first then oldest, rechecks owner and
  target, and *notifies* interactive users to resend (stored classification reused on resend). That is not the
  addendum's automatic queue drain: nothing is redispatched. Scheduled tasks re-run only on their 15-minute
  capacity retry. Notification ordering must not be counted as drain completion.
- F3 as built is a **fail-closed gate only**: empty verifier registry and privacy always `unknown`, so Free execution
  is impossible. It is not the original Free outcome.

## Evidence: why automatic drain cannot run today

Held r10 sessions 340453ca / f0fca468: 0 input messages, 0 messages, 0 `agent_turn_dispatches` rows, 1
`agent_router_grid_attempts` row (kind free_queued, body-free). Input rows are written by the stream bridge only
after the engine accepts a turn, and the Free descriptor is body-free by design. So the original turn text,
parts, attachments and per-turn options are not recoverable; redispatch would require inventing them.

## Missing contracts for automatic drain

1. **Held-turn record** (owner-scoped, body-bearing, NOT in the Free queue): new table `agent_held_turns`
   (id, session_id, owner_user_id, origin desktop|prompt_api|mobile|scheduled, parts_json incl. attachment refs,
   per-turn options (modelOverride/thinking/fastMode/agent), consent_generation, created_at, status
   pending|claimed|dispatched|superseded|cancelled, dispatch_id). Additive migration (SQLite + Postgres bootstrap),
   same retention/deletion rules as `agent_session_messages`; the Free descriptor keeps only the held-turn id.
2. **Idempotency**: claim via single UPDATE `status='claimed' WHERE id=? AND status='pending'`; dispatch row gets
   `predecessor_id = held_turn_id` and origin `free_drain`; a held turn with any dispatch row is never re-claimed.
3. **Never partly executed**: only held turns with no `agent_turn_dispatches` row and no engine user message are
   eligible (provable: hold returns before dispatch). Scheduled holds create a session row but never prompt.
4. **Recheck at claim**: owner unchanged; session not archived/closed/error-by-user-cancel; no newer user input in
   the session since `created_at` (then status superseded, user notified); permission mode and profile unchanged or
   still allowed; Dayflow non-reuse marker absent; attachments still readable under the same owner/project rules;
   remote-data consent still on if the stored classification came from the remote classifier (else reclassify by
   rules or hold); session still `modelMode=auto`; Free state recovered (fresh positive capacity, not a reset time).
5. **Dispatch path**: replay through `handleInputFrame` with the controller's socket shim (same as
   `POST /agent-sessions/:id/prompt`), origin `free_drain`, stored parts/options; normal routing with stored
   classification. Mobile held turns drain through the same desktop entry (session-owned), never by
   re-presenting a device token. Scheduled holds: set the task's `next_run_at` to now on release (a fresh full run,
   never a replay), keeping enabled/owner checks.
6. **Cancellation**: user-visible "held" state with a cancel action -> status cancelled; drain skips it.

## Bounded implementation + test plan (needs explicit approval; touches shared dispatch paths, HIGH risk)

- D1 migration + repository (`agent_held_turns`), unit: additive/idempotent, owner scoping, claim race (two
  claimers, one wins), body never copied into Free state or attempts rows.
- D2 hold writers: ws_gateway / prompt route / mobile proxy store the held turn before returning the hold.
- D3 drainer: single-flight on verified recovery, T1 first then oldest, rechecks above, dispatch via shim.
- D4 scheduled: release bumps `next_run_at`.
- Tests (synthetic sandbox, fake loopback, routing on, free enabled override): held desktop turn drains exactly once
  with original text at the fake provider; superseded turn not sent; archived/owner-changed/consent-revoked not
  sent; cancelled not sent; two concurrent recoveries still one dispatch; scheduled task re-runs immediately after
  release; crash between claim and dispatch leaves `claimed` (never auto re-sent; surfaced for user action).

## F3: genuine verifier design (observable effects only)

Verifiers are code, registered per task class, and check side effects that can be independently recomputed.
No LLM judge, no self-report by the free model, no canned pass. Unverifiable classes never run on Free.

| Class | Inputs declared by the task | Verifier (observable) | Required negative case |
|---|---|---|---|
| code-change | repo path, allowed paths, test command | apply diff in a scratch copy; diff limited to allowed paths; declared test fails before and passes after (exit codes) | wrong patch, patch outside allowed paths, test already passing before |
| structured extraction | source document, JSON schema | schema valid AND every extracted string occurs verbatim in the source (offsets recorded) | hallucinated value absent from source, schema violation |
| format conversion (CSV/JSON/YAML) | source file, target format | parse target; round-trip back equals source (canonicalized) | dropped row, changed value |

Open-ended writing, advice, email/calendar actions with external effects: no verifier -> never Free.

## F3: local privacy preflight design

Returns `false` (public) only when ALL hold, else `unknown`/`true`:
- no attachments, or each attachment locally inspected by the same deterministic scanners;
- the Free request context would be built WITHOUT memory, Dayflow, session history or profile prompt containing
  user data (public-only context builder);
- deterministic scanners find none of: emails, phone numbers, street addresses, names of known users/contacts
  (users table, PCO people cache), secret/token patterns (API key formats, bearer/JWT, private-key headers), absolute
  home paths, PCO/church identifiers;
- the session's project is not marked private and the owner opted into Free for this class.

Acceptance: independent labelled synthetic corpus (public tasks -> false; each private category -> not false,
including paraphrased/obfuscated forms); scanner misses default to `unknown`; no network.

## Acceptance to call Free complete

Automatic drain tests above pass live in the sandbox; at least one verifier class passes positive AND negative
fixtures against a fake loopback free provider (zero external calls); privacy corpus passes; every Free result
released only after its verifier PASS; real free-provider qualification remains a separate approval (spend/online).

## F3 product integration contract (not implemented; 2026-10-09 r13)

executeFreeExtraction has no product caller. Before any API/engine entrypoint:
1. Task-kind API: an explicit structured-extraction request type (declared source + bounded schema), never inferred
   from free-form chat.
2. publicSource from an operator-managed public-source registry resolved server-side; ownerOptIn from the owner's stored
   Free opt-in. Request-body booleans are never accepted as proof.
3. Context builder that provably sends only the fixed instruction + declared source (no memory, Dayflow, history,
   profile prompt), with preflight over every outbound surface (done in the module).
4. verifiedFreeModels from a qualified availability source (real free-provider qualification is a separate online/spend
   approval).
5. Live proof through the real API with a fake loopback free provider: release on verifier PASS, rejection otherwise,
   privacy holds with zero provider calls.

## F3 authoritative provenance contracts (r14; implemented for structured extraction only)

**Public-source provenance (operator registry).** File `router-free-extraction.json` in the Rhythm app-data directory
(next to `decision-router.json`), written only by the operator; no API writes it. Schema v1:
`{version:1, endpoint:{baseUrl, authProvider}, qualifiedFreeModels:[...], publicSources:[{id,label,text}]}`.
- The extraction request names a `publicSourceId`; the server loads the source TEXT from the registry. Clients can
  never send source text, a public flag, context or opt-in (any key other than `publicSourceId`/`fields` -> 400).
- Validation fails closed: ids `^[a-z0-9][a-z0-9_-]{0,63}$` unique, label 1-200 chars, text 1-20,000 chars, <=100
  sources; endpoint https (http only for loopback); authProvider names an `api` entry in the engine auth store;
  qualifiedFreeModels must be models of the configured Free grid (operator qualification list; absent = nothing
  qualified = held). Registry text is still scanned on every request (operator mistakes are held as private).
**Owner opt-in (stored).** Table `agent_free_opt_ins(owner_user_id, task_kind, enabled, updated_at)` keyed by the
authenticated user; set only by that user via `PUT /agent-free/extraction/opt-in`; read server-side per request.
**Entry point.** `POST /agent-free/extractions {publicSourceId, fields}` (authenticated, local agent surface only):
disabled unless `free_mode.enabled`; held unless Free Mode is active (all subscription accounts verified exhausted,
budget 0 = no paid OpenRouter); context is fixed empty (no memory, Dayflow, history, profile); preflight over every
outbound surface before any reservation; executor releases output only on independent verifier PASS.
**Path.** API -> provider directly (same as the paid Decisions classifier). The engine is deliberately NOT in the
request path: an engine session would add its system prompt, environment and tool surfaces that cannot be proven public.

## Native engine-chat structured extraction: contract and BLOCKER (r16, read-only inspection)

Required contract (original acceptance): operator-public source + stored owner opt-in (done server-side in r14); no client
provenance; nothing private outbound (memory, Dayflow, history, profile, attachments, tools, host/user identity); engine
output buffered and withheld from every user surface until the independent verifier passes; wrong/self-reported output
rejected; private/malformed tasks make zero provider attempts.

Why the existing native engine path cannot guarantee "nothing private outbound" (vendored fork v1.14.49, unchanged):
- session/prompt.ts:2608-2614 builds EVERY turn's system as `[...env, ...instructions, ...skills]` unconditionally.
- session/system.ts:53-67 `environment()`: working directory, workspace root, git flag, platform, date, model id. In
  production these paths sit under the user's home directory.
- session/instruction.ts:14-16, 59-63, 77-130: global `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md` (unless the
  process-wide flag OPENCODE_DISABLE_CLAUDE_CODE_PROMPT), project AGENTS.md/CLAUDE.md walking up from the directory, and
  `config.instructions` files/URLs. User-authored, engine-process-global; no per-session switch.
- session/llm.ts:309-332: agent/provider prompt + `input.system` + `user.system`, then plugin
  `experimental.chat.system.transform` (used by apps/api_server/opencode_plugins/rhythm-anthropic-accounts) and
  `chat.params` hooks (plugin/codex.ts:648) may change system text/params outside Rhythm's control.
- Tools can be disabled per message (llm.ts:709-714 `user.tools[k] === false`), and an unmapped engine session in a
  neutral directory would keep output away from the stream bridge - those parts are feasible; the system-prompt
  sources above are not.
An API-side copy of the engine's instruction discovery would be a fragile guess, not a guarantee.

BLOCKER: guaranteeing public-only native execution needs a NEW engine primitive - a per-request public-only mode that
skips environment, instruction files, skills and plugin system/params transforms, sends zero tools and only the single
user message, and returns (or lets the API supply verbatim) the exact outbound system/messages so the API can preflight
them. That is a vendored-fork change outside the authorized `mcp-scope-*`/pin-fix scope (AGENTS.md "Vendored subtree")
plus an engine rebuild on the path of every engine request (HIGH risk). Requires AJ's explicit authorization. Until
then the authenticated F3 API (direct provider HTTP + verifier, zero engine sessions) is the only Free execution path,
and native engine-chat extraction is NOT proven.

## Original-scope reconciliation (r18)

Native engine chat is no longer a completion gate (not in the 04:54:43 addendum). Supported positive product classes:
registered public coding (vm + trusted executable cases), registered public extraction (offset/schema/value), and
registered public image-design (actual image helper bytes -> verified description -> text model -> exact oracle), all via
authenticated API and server-side provenance/opt-in. Exact 13-case mapping: ledger final-r18. Native engine public-only
primitive remains an optional future architecture change, not required here.

## r24 security correction

Public coding execution is disabled: Node `vm` is not a security boundary and was removed. Registered coding tasks return
`untrusted_code_execution_unsupported` before any provider/budget call. Re-enabling requires a genuine OS-isolated executor
(read-only source/root, no network/credentials, descendant containment, CPU/memory/wall limits, output-only IPC) and its
own approval. Image design + structured extraction remain verified supported classes.

## r25 recovery completion

Idle queue release is event-driven from a genuinely fresh usage snapshot into the existing single-flight drainer; no
new daemon/turn. Automatic account provenance is reconstructed after restart only from exact durable grid attempt
provider/model/account with accountSource=router; explicit PATCH persists pinned provenance; missing/stale/corrupt stays
explicit. Live idle + real restart proofs PASS. Public coding remains unsupported/fail-closed.

