---
date: 2026-10-06
repo: Rhythm
branch: codex/lazy-tool-loading-default-20261006
pr: null
issues: []
status: unverified
tags: [run, rhythm, dayflow, native-provider-guard, fork]
---

# Dayflow native provider guard (native half) — task record

Authority: task4 `core-dayflow-native-api-contract-plan.md` (C0, SHA-256
`6556b1eb…78f9`) and `core-dayflow-native-api-contract-fixtures.json` (SHA-256
`2c273791…c6`, hash re-asserted by the tests). Writable slice only:
`apps/opencode_fork/packages/opencode` (lazy-loading checkout). Source-tested only; no
live process, API, provider, install, commit or push. GitNexus runner/tools were
unavailable: callers below were traced manually, impact is UNKNOWN to the tool.

## C1 — FROZEN interface/source receipt (parser, pending frame, registration)

All paths relative to `apps/opencode_fork/packages/opencode`. DTO, field names, enums,
bounds and digest convention are the C0 fixture exactly; nothing in C0 was changed.

**Module `src/session/rhythm_provider_guard.ts`** (the API adapter binds to these):

| Export | Contract |
| --- | --- |
| `GUARD_SCHEMA_VERSION=1`, `GUARD_BOUNDS`, `GUARD_ADMISSION_PATH="/dayflow-agent/provider-admission"` | constants equal to fixture `bounds` (asserted) |
| types `GuardRequest/GuardResponse/GuardPendingExport/GuardUnavailableExport/GuardSourceProof/GuardEnrollmentResponse/GuardFrame/GuardRecord` | exact C0 shapes |
| `parseGuardRequest(raw)` | exact keys; ids 1–200; nonce `^[A-Za-z0-9_-]{24,64}$`; generations 1–128; attempt int 0–100; purpose enum; digest 64 lowercase hex; ≤4096 B |
| `parseGuardResponse(raw, expectedRequest)` / `parseGuardResponseText(text, expected)` | exact keys, exact request echo, version 1, ≤32768 B (text form), overlay ≤3800 B and `sha256(text)` must match, projection 1–64 unique ids that include `fromUserMessageId`, cross-field rules: `ordinary`(raw reusable, no overlay/projection, reason `none`), `allow`(raw reusable, no projection, reason `none`), `project`(raw NOT reusable, projection required, reason `source_changed`\|`receiver_changed`), `hold`(raw NOT reusable, no overlay/projection, reason ≠ `none`). Any violation ⇒ `{ok:false}` ⇒ caller holds |
| `parseGuardExport(raw)`, `parseSourceAnchorQuery(str)`, `parseEnrollmentRequest(raw)` | strict (≤64 unique anchors; ≤64 summary ids total; ≤32768 B) |
| `canonicalJson`, `guardInputDigest(preparedInput, originGroups)`, `sha256Hex`, `newGuardNonce()` (32 chars), `ENGINE_GENERATION` (per process) | digests reproduce every fixture `inputDigest` (tested) |
| `installGuardFrame(frame) → release`, `lookupGuardFrame`, `guardFrameStatus`, `guardFrameIsCurrent`, `buildGuardExport(...)`, `resolveSourceProofs(messages, frame, anchors)`, `runnerGenerations` | transient in-memory pending frame; see below |
| `readGuardRecord`, `markGuardManagedSeen`, `enrollGuard`, `makeGuardStorage` | monotonic registration in existing Storage |

**Pending-frame semantics (transient only).** A frame is attempt-scoped: installing a
newer frame for the same SDK marks every older one `replaced`; an aborted attempt
signal reads `cancelled`; a frame installed under a runner generation that is no
longer the SDK's current one (`run-state.ts` sets/clears `runnerGenerations`) reads
`replaced`; a released/never-installed nonce reads `not_pending`. No tombstones. The
export carries identities and digests only; source proofs come from native stored order
(`stored`, `visible` = id present in this attempt's prepared input, `relation` to the
frame's `userMessageId`, `derivedSummaryIds` = covering compaction summaries honoring
`tail_start_id`); an unknown current message or anchor gives `unknown` (API holds).

**Routes (existing owned-engine boundary; disabled unless
`RHYTHM_MANAGED_CONTEXT_EXPORTS=1`, otherwise 404 like the other managed exports):**
- `GET /session/:sessionID/rhythm-provider-frame/:requestNonce?sourceAnchorIds=<JSON array>` →
  exact pending export or `{schemaVersion:1,status:"cancelled"|"replaced"|"not_pending"}`;
  malformed/duplicate/over-bound query or an export that fails its own strict parser ⇒ 400
  (never a truncated success).
- `POST /session/:sessionID/rhythm-dayflow-guard` body exactly `{schemaVersion:1,guarded:true}` →
  exact `{schemaVersion:1,sdkSessionId,engineGeneration,guarded:true}` only after the durable
  write; extra keys / `guarded:false` / wrong version ⇒ 400; idempotent; no disable path.

**Registration record** (existing Storage, key `["rhythm","dayflow-guard",<sdkSessionId>]`,
`{schemaVersion:1,managedSeen,guarded}`): flags only rise (module semaphore serializes the
read-merge-write; `guarded` implies `managedSeen`); corrupt/unreadable ⇒ state `error`
(callers hold, never `absent`); unsafe ids (not `^[A-Za-z0-9_-]{1,200}$`) are refused;
enrolling over an unreadable prior record writes the protective superset.

**Native registration timing facts the API should assume:** native only knows an SDK as
managed after its own `markGuardManagedSeen` (provider slice, below) or an enrollment call;
a pre-upgrade SDK with neither is indistinguishable from standalone (C0 limit, unchanged).

**Concrete C1 deviations/limits (report, not silent):**
1. `makeGuardStorage` builds the existing Storage (`Storage.defaultLayer`) at the handler's
   layer construction because the server route layer (`server.ts`, outside the owned paths) does
   not provide `Storage.Service`; a second Storage handle onto the same data dir is therefore
   used. Writes are serialized process-wide by the module semaphore; a reader racing a
   non-atomic write sees `error` (hold), never a downgraded flag.
2. `allow`/`ordinary` require `reason:"none"` and `project` requires `source_changed|receiver_changed`
   (C0 fixture values); the API must not emit other combinations.
3. Enrollment payload is decoded as `Schema.Unknown` and validated by the strict parser so excess
   keys are rejected (the HttpApi struct decoder would silently strip them).

**C1 tests (source-only, synthetic):** `test/session/rhythm-provider-guard.test.ts` (17) —
fixture hash pin, digest reproduction for all six input materials, all fixture
requests/exports/responses parse and echo, bounds equal fixture, strict negatives (extra keys,
version, nonce, attempt, echo mismatch, cross-field, oversized overlay/response, bad digest),
frame lifecycle (pending/not_pending/cancelled/replaced/runner change), source proofs incl.
compaction tail and unknown anchors, Storage record (absent→managed→enrolled, never clears,
concurrent writers, unsafe id, corrupt record). `test/server/httpapi-rhythm-provider-guard.test.ts`
(3) — real `Server.Default()` HTTP routes: disabled-by-default 404 with no write, enrollment
exactness/idempotence/monotonicity and 400s, frame export pending/replaced/cancelled/not_pending
with stored-order proofs and no source text.

**C1 SHA-256 receipt** (printed by the `source receipt` test; owned files at the freeze):

```
872d0f62c6dcf33d2957d7563924781b3e61a178f7570596f402065d77fdc272 src/session/rhythm_provider_guard.ts
19bfdaf7ed3a01e2af68229d3637f2366739f8d584b17386978c2ff64c90bee6 src/session/run-state.ts
3f14e1dcc4f3b01671ab5efa57ae1e81f706f9c75b063ddc8f8c6276cb1922de src/server/routes/instance/httpapi/groups/session.ts
d32d6e2dbd842e6d80c4004edac9d5ebafb0f489f103f0d98125a7018767cf72 src/server/routes/instance/httpapi/handlers/session.ts
a756ddb1db1b94318b11fbf284432d4b8f64acbd0aef1d960dd0bbdf693dc45c test/session/rhythm-provider-guard.test.ts   (before the receipt test was added: hash differs by that test)
acf556b14e5a5146321dd5ead9b640cb6038626997f0cfe0bb082b5e501ac33e test/server/httpapi-rhythm-provider-guard.test.ts
```
(`llm.ts`, `prompt.ts`, `compaction.ts` unchanged at C1: `20b6ab30…14db9f4`, `39b2f3cc…93231c`,
`81a20bee…ea90`.) Checks at C1: `bun run typecheck` exit 0; the 17 + 3 tests above pass.
Neighbouring `httpapi-session/query-schema-drift/sdk/schema-error-body/authorization` tests:
50 pass, 1 existing failure unrelated to this work — `serves remaining non-LLM session
mutation routes` expects the permission-reply route to return `true` for an unknown
permission id but gets 404 `Permission request not found` (permission service behavior; not
touched).

After C1 only **additive** exports are expected in the guard module; any change to a frozen
signature/semantic above goes to Astra first.

**C1 amendment (one post-freeze edit, no contract/DTO change):** `makeGuardStorage` now builds the
existing `Storage.defaultLayer` with `Layer.build` in the caller's scope (it previously built it in a
scope that closed immediately). Its type gained `Scope` in the requirements; the handler already
runs inside the handler layer's scope. Hash of `rhythm_provider_guard.ts` after the amendment is in
the final receipt below (`eac5f320…ecfb9`); `groups/session.ts` and `handlers/session.ts` hashes are
unchanged from the C1 receipt.

## Provider slice (completed after C1)

New file `src/session/rhythm_provider_projection.ts` (kept separate so the C1 module stays frozen);
edits to `src/session/llm.ts`, `prompt.ts`, `compaction.ts`, `run-state.ts`.

- **Applicability (llm.ts `run`)**: managed = durable record exists (any state), OR the trusted local
  integration is observed now (then `markGuardManagedSeen` writes durably; a failed write leaves the
  record unknown ⇒ attempts hold). Unreadable record ⇒ guarded-unknown (never "absent"). No record and
  no integration ⇒ the guard is not installed at all (standalone; no API read, input unchanged).
  Config disappearing cannot un-manage an SDK. `trustedRhythmIntegration(cfg)` accepts only the
  server-configured local MCP entry `mcp.rhythm` (not disabled) with loopback `http` `RHYTHM_AGENT_URL`
  (no userinfo) and a non-empty `RHYTHM_API_TOKEN`; never the production URL, never model/session input.
- **Per attempt (middleware, last = closest to the model)**: `providerGuardMiddleware` runs in
  `transformParams`, i.e. for every real `doStream`/`doGenerate` including AI-SDK retries, each
  prompt-loop step, compaction and the title call. It: counts attempts per (sdk, user message) (>100 holds);
  derives origin groups and `originCoverage` from private per-message markers; computes
  `inputDigest` over `{prompt (markers stripped), OAuth instructions}` + origin groups; installs the
  pending frame; performs ONE bounded exchange (2 s deadline, capped body read, strict parse, no redirects,
  Bearer token only in the header, nothing logged); then, synchronously, verifies abort + frame still
  current + digest unchanged and applies the decision to a copy; the frame is released immediately.
- **Decisions**: `ordinary` ⇒ unchanged (cached for this process generation only when
  `guardRegistrationVersion===1`, keyed by SDK+agent, usable only if the API is later unavailable AND the
  durable record is not enrolled). `allow` ⇒ unchanged, optional overlay inserted as an extra system
  message (or appended to OAuth `instructions`). `project` ⇒ copy only: drop whole stored assistant /
  derived-summary entries at or after the earliest affected anchor (stored order; ascending message ids for
  hidden anchors), so tool call/result pairs leave together; authored users and static text stay; a
  trailing compaction control with derived spans (previous summary/plugin context) is replaced by its
  static-only text or the request holds; the legacy `user.system` text is cut from the leading system /
  OAuth instructions only if found exactly once; ambiguity ⇒ hold. `hold`, any parse/echo/size/timeout/HTTP
  failure, aborted/replaced frame, or a digest change ⇒ `RhythmProviderGuardHold` (body-free), no provider
  request. GitLab workflow models cannot be bound and always hold for managed SDKs.
- **Origins (real stored identities, transient)**: `prompt.ts` (answer + title) and `compaction.ts`
  pass a lazy `origins` thunk built from the exact stored messages converted for that call
  (per-message conversion counts; markers attached by `markModelMessages`, stripped before the provider).
  Compaction supplies the selected head, the control message id, the initiating authored user (stored order)
  and whether the control prompt embeds derived spans. No persisted lineage store.
- **Frame ↔ route**: the export route and the middleware share the C1 registry, so the synthetic API reads
  back exactly the frame the engine installed.

## Provider-slice tests (source-only, synthetic; NOT cross-process API proof)

`test/session/rhythm-provider-guard-native.test.ts` (16): real SessionPrompt/LLM/MessageV2/compaction via the
existing TestInstance/TestLLMServer harness with an in-process synthetic API on `guardTransport`
(it reads the pending frame through the same export builder first). Covers: both retained diagnostics'
assertions now satisfied (distinct user + real compaction: no dependent assistant/summary in provider input,
static Secretary text and authored users kept, stored history untouched; same-user tool loop re-guarded with
stale overlay + tool group dropped); positive control (first request allowed unchanged); frames pending/
complete/current with compaction `control` + initiating user; overlay per attempt only; hold ⇒ zero provider
requests; throws/500/non-JSON/wrong echo/extra key/oversize ⇒ hold; standalone untouched and enrolled SDK
guarded without config; known-ordinary survives an outage until enrollment; AI-SDK retry ⇒ two frames,
attempts 0/1, distinct nonces; agent change discards the ordinary cache; aborted attempt holds; pure
projection/marker/instructions/static-compaction/trusted-config/origins units.

The original retained Sol file (`core-history-sol-fork/.../sol-dayflow-provider-history.test.ts`) was not
modified. Note: its tool-loop test calls `sol_invalidate_source` directly, which is a lazy-deferred MCP tool
today; my version dispatches it through `mcp_dispatch` (same actual tool execution).

## Final checks and receipt

- `bun run typecheck` exit 0.
- `bun test test/session/rhythm-provider-guard.test.ts test/session/rhythm-provider-guard-native.test.ts
  test/server/httpapi-rhythm-provider-guard.test.ts` → 36 pass / 0 fail.
- `bun test test/session src/session` → 476 pass / 5 skip / 0 fail (includes the prior lazy/hosted suites).
- Existing neighbouring failure, unrelated: `test/server/httpapi-session.test.ts` "serves remaining non-LLM
  session mutation routes" (permission-reply route 404 for an unknown id). Not re-run after C1 beyond that.

```
eac5f3208d884345638501a5235c8dc5d5496087e77064a697e08db7815ecfb9 src/session/rhythm_provider_guard.ts
287980fd593896f8c025c46b68a4a6bf9be99c3a4fd217dd6c09db7443a0d11a src/session/rhythm_provider_projection.ts
19bfdaf7ed3a01e2af68229d3637f2366739f8d584b17386978c2ff64c90bee6 src/session/run-state.ts
cd31424ad416f9597864998d3b34fdb29e6f135d22179e597cb526179adc72b1 src/session/llm.ts
b107a1c01400ec17662d0530817a51379db24c485e988cf2b1898e6bb992930a src/session/prompt.ts
c974ef9eb65709b2116efb0d4cfd1cd0b36104589860b72776838c9d12c6c4e0 src/session/compaction.ts
3f14e1dcc4f3b01671ab5efa57ae1e81f706f9c75b063ddc8f8c6276cb1922de src/server/routes/instance/httpapi/groups/session.ts
d32d6e2dbd842e6d80c4004edac9d5ebafb0f489f103f0d98125a7018767cf72 src/server/routes/instance/httpapi/handlers/session.ts
9a4ca5efb6cd1ac8df07f0edc93ef6071eaa8265e996d098a1b063f7b1395be4 test/session/rhythm-provider-guard.test.ts
e1f4bc00e73fcece8ec91752f2eeef5fbec237c177630e0f0e2360c71dc11927 test/session/rhythm-provider-guard-native.test.ts
acf556b14e5a5146321dd5ead9b640cb6038626997f0cfe0bb082b5e501ac33e test/server/httpapi-rhythm-provider-guard.test.ts
```

## Corrective turn (after Sol/Astra HOLD of the 12-path packet) — source-only

Preserved negatives applied exactly (`git apply`, assertions unchanged; first `git apply` from the package
silently skipped the C1 patch because its paths are package-relative, so it was re-applied with
`--directory=apps/opencode_fork/packages/opencode`): `test/session/sol-c1-guard-negatives.test.ts` (new file)
and the two additions in `test/session/rhythm-provider-guard-native.test.ts`. Reds witnessed before any source
edit: C1 corrupt-record (`guarded` lost), C1 missing runner generation (`pending`), provider clean tool result
absent from the next request, title purpose `answer` (expected `summary`) — 4 failures.

Corrections (all green):
1. **Monotonic registration** (`rhythm_provider_guard.ts`): unreadable/corrupt prior record ⇒ the protective
   `managed+guarded` superset, never `guarded:false`; an absent record still becomes managed-seen only.
2. **Positive runner currency**: a frame is `pending` only if `runnerGenerations.get(sdk)` equals its
   `runnerGeneration`; missing or different ⇒ `replaced` (abort still `cancelled`, unknown nonce `not_pending`).
   The middleware now holds before any API read when the SDK has no current runner (no fallback generation).
3. **Storage composition**: `server.ts` provides the existing `Storage.defaultLayer` to the route layer; the handler
   uses `Storage.Service`; `makeGuardStorage` (private handle) is deleted. The LLM layer consumes the provided
   service (`Layer.provide(Storage.defaultLayer)` like Session/Revert/Summary), no manual handle.
4. **Title is `summary`** on every branch (`guardPurpose:"summary"`, origins purpose `summary`); the native
   middleware holds any non-answer response (summary/title, compaction) that carries an overlay.
5. **Clean-generation certificate** (`rhythm_provider_projection.ts`): at the actual provider handoff
   (`wrapStream`, after the real `doStream`) a safe `project` exposure with NO overlay, complete origin coverage
   and a known processor assistant (`StreamInput.outputAssistantId` = `handle.message.id`) seals, at the stream's
   `finish`, `{assistantId, complete toolCallIds, agent, basisDigest, from, anchors, generating input digest}`
   in transient runner state keyed by the current runner generation (bounded to 64; cleared on runner creation,
   idle, cancel and finalization in `run-state.ts`). The next STRICTLY admitted `project` request keeps that whole
   group (call and result together) only if the fresh response has the same `basisDigest`, same `fromUserMessageId`,
   same anchor set, same agent, the same tool-call set, the entry is not itself an anchor, and the generation is
   still current. Old assistants, derived summaries, compaction/summary/title outputs, partial or mixed groups,
   changed basis, aborted/failed/unexposed attempts and any other runner never get an exemption. Every attempt
   still performs fresh admission; nothing is exported, persisted or granted.

**Basis dependency (not faked):** native treats `basisDigest` as the authoritative receiver/dependency witness
identity (C0 addendum). The synthetic API in the preserved red test emits a constant basis, which is why that
fixture is satisfied; a real producer MUST emit a stable qualified basis (receiver/owner/project/root/agent +
exposure-ledger witnesses + source reference versions, including any new overlay or body-producing tool witness,
excluding nonce/attempt/inputDigest). Until the queued API C2 provides it, treat the exemption as dependent on that
definition; an API that emits a constant/unknown digest would defeat the "new body changes the basis" property.

Tests added (existing in-process harness only): changed-basis harness negative (continuation under a different
basis withholds the fresh result, tool still ran once, certificates gone after the runner), certificate unit
negatives (basis/anchors/agent/purpose/partial group/anchor/summary/old assistant/other generation/stale
registration/bound/clear), exempt-group projection keeps call+result together, no-runner hold before API read,
non-answer overlay hold, orphan frame (`replaced`) via the real route. The source-hash-printing test was removed;
hashes are collected externally.

Commands (package dir): `bun test ./test/session/sol-c1-guard-negatives.test.ts
./test/session/rhythm-provider-guard.test.ts ./test/session/rhythm-provider-guard-native.test.ts
./test/server/httpapi-rhythm-provider-guard.test.ts --timeout 30000` → 45 pass / 0 fail, 294 expects, exit 0.
`bun run typecheck` → exit 0. `bun test ./test/server/httpapi-session.test.ts` → 10 pass / 1 fail — the same
permission-reply 404 case reported earlier (unrelated, UNKNOWN baseline). The 476-test suite was not repeated.

Remaining gates (not proved here): real cross-process API↔engine admission and the stable qualified basis (C2),
old-ledger/reload/V1 handling, root result hydration/persistence, composed automatic overlay + useful tool
continuation, provider-specific schema behavior, OAuth instructions request, installed/live behavior.

## Completed-payload integrity correction (after the b0b9491c HOLD)

Reproduced first: preserved patch `dayflow-native-correction-payload-sol.red.patch` applied unchanged
(path-checked with `git apply --check`); `bun test ./test/session/rhythm-provider-guard-native.test.ts
--test-name-pattern "Sol payload:" --timeout 30000` → 1 fail (edited completed payload reached the next request:
expected false, received true).

Fix (existing prompt/projection files only; no part-update, storage, DTO or API change):
- The raw provider `finish` now records only a **provisional** certificate (generation provenance); a
  provisional certificate never exempts anything (`cleanGroupFor` returns sealed ones only).
- `prompt.ts`, right after `handle.process` returns (processor cleanup has run): one exact
  `MessageV2.get({sessionID, messageID: handle.message.id})`, then `sealCleanGroup` seals **once**: the group must be
  a non-summary assistant with no error and a finish, every tool part `completed`, and the tool-call set equal to the
  calls observed at the provider handoff. The seal stores `completedGroupDigest` — canonical-JSON SHA-256 over the
  model-visible content: generated text, reasoning, and each tool part's name, call id, input, output, MCP result,
  compaction flag and attachments (mime/url/filename). Times, titles, tokens, cost and provider metadata are
  explicitly excluded. Any non-clean group (pending/running/error/interrupted/partial/summary/ambiguous/missing) drops
  the certificate. A sealed certificate is never resealed and a later handoff cannot overwrite it, so an edit can only
  fail the comparison.
- Receiving side: `buildProviderOrigins` computes the same digest for each whole stored assistant group;
  `exemptCleanGroups` additionally requires digest equality with the seal (plus the existing generation, agent,
  basis, from/anchors, tool-call set, anchor-exclusion and runner checks). A changed group loses only its own
  exemption and follows the old conservative projection; other unchanged clean groups stay.
- Ordinary completion is unaffected: running→completed progression happens before the seal, so the original
  clean-result positive remains green.

Tests: the preserved payload negative is green; all prior native cases stay green (28 total in the native file
including the four original negatives and the clean-result positive). Unit additions: provisional never exempts, seal
once / no refresh / no overwrite, edited digest loses exemption, ten non-clean group shapes never seal, digest binds
text/reasoning/input/output/mcp/attachments and ignores accounting.

Commands (package dir): `bun test ./test/session/sol-c1-guard-negatives.test.ts
./test/session/rhythm-provider-guard.test.ts ./test/session/rhythm-provider-guard-native.test.ts
./test/server/httpapi-rhythm-provider-guard.test.ts --timeout 30000` and `bun run typecheck` — results recorded in the
final report of this turn. No broad suite. Still separate gates: real C2 stable dependency/receiver basis and
body-producing-witness causality, overlay-bearing useful continuation, root result persistence, cross-process proof.

## Complete canonical digest correction (after the ea8c7a1c HOLD)

*Correction to the previous section:* it described the seal digest as covering text, reasoning and tool fields while
excluding "provider metadata". That whitelist was lossy and the exclusion wrong: top-level part provider metadata
(including signed-reasoning signatures, tool call metadata and `providerExecuted`), the assistant's stored
provider/model selectors, step-start structure and the exact `compacted` value all change the ACTUAL
`MessageV2.toModelMessages` input. Historic text above is kept for chronology.

Reproduced first: preserved patch `dayflow-native-payload-sol-mapped.red.patch` applied unchanged (`git apply
--check` then apply); `bun test ./test/session/rhythm-provider-guard-native.test.ts --test-name-pattern "Sol mapped
payload:" --timeout 30000` → 1 fail listing seven missed changes (reasoning metadata/signature, text metadata,
tool call metadata, providerExecuted, stored model selector, step-start structure, compacted 0→1).

Fix (only `rhythm_provider_projection.ts`): `completedGroupDigest` now hashes the ordered canonical group —
provider/model selectors, every part in order with ALL its top-level fields (kind, text, provider metadata,
tool/callID …) and each tool state in full (status, input, output, MCP content, attachments, and any other field) —
removing ONLY accounting that conversion never reads and that completion legitimately rewrites: part/message/session
ids, per-part `time`, tokens, cost, snapshots, and a tool state's title/metadata/start/end. `state.metadata` (accounting)
is distinct from top-level part `metadata` (provider metadata, kept). `compacted` is bound by exact value (0 ≠ 1).
Unrendered fields are retained conservatively; no second converter, whitelist or normalization to presence. Seal point,
once-only sealing, provisional lifetime, current-generation and whole-group comparison are unchanged.

Checks (package dir): the new converter case red→green; then `bun test ./test/session/sol-c1-guard-negatives.test.ts
./test/session/rhythm-provider-guard.test.ts ./test/session/rhythm-provider-guard-native.test.ts
./test/server/httpapi-rhythm-provider-guard.test.ts --timeout 30000` and `bun run typecheck` (results in the turn
report). No broad suite. Still separate gates: real C2 stable dependency/receiver basis and body-producing-witness
causality, overlay-bearing useful continuation, root result persistence/hydration, cross-process API/native proof.

## Overlay-bearing continuation extension (Astra-approved, same owner)

Gap: `certifiable` required `decision.overlay === null`, so a current C2 `project` + qualified overlay request recorded no
provisional handoff and its freshly generated ordinary tool call/result group was dropped at the next projected request.
Change (only `rhythm_provider_projection.ts`): a projected ANSWER with an output assistant identity may now hand off whether
or not it carries an overlay. Everything else is unchanged: certificate only after the actual `doStream` handoff and a
successful `finish` (error/truncated/aborted ⇒ none), sealed once from the completed canonical group (full mapped content
digest), exempted only for the exact same fresh `basisDigest`, SDK/runner generation, agent, projection `from`/anchor set and
tool-call set, runner-scoped lifetime and cleanup; compaction/summary/title still reject an overlay; `allow` without a
projection gets no handoff; old invalid quote/summary/tool groups are still dropped. The overlay's dependencies are NOT
checked natively — they are the producer's `basisDigest` (a changed witness/reference/overlay source/receiver must change it).

Tests (existing `rhythm-provider-guard-native.test.ts`, actual middleware/handoff/seal; red first against the original source):
- positive: projected+overlay → ordinary tool result → next same-basis projected+overlay request retains the whole
  call/result, old quote/summary/overlay absent, overlay exposed on both answers and never on compaction (red before the edit);
- negatives (basis changed by V1 witness / source reference / overlay source / receiver, and a different anchor set): the
  fresh result is dropped while the overlay still applies;
- edited completed overlay-era payload loses its exemption (red before the edit);
- unit handoff rules: success hands off then seals once; error/truncated/aborted streams, `allow`+overlay, missing assistant
  identity and a history-only purpose confer nothing (the success case is red before the edit).
The "API" is a STUB with a valid opaque producer basis computed from labelled dependency material; this does not prove the real
C2 basis is stable, and none of it is cross-process proof. GitNexus: `providerGuardMiddleware` UNKNOWN/target not found
(new uncommitted symbol not indexed); manual caller: `llm.ts:615`. No reindex/install.

## Concrete limits / missing primitives (not silently worked around)

1. **No persisted origin metadata exists natively.** Origins are rebuilt per attempt from stored messages via
   per-message conversion; the tests show the counts account exactly (answer and compaction). A provider
   transform that drops or merges messages (e.g. Anthropic empty-message filtering, tool-message merging)
   makes coverage `ambiguous`; the API then must hold for dependent sessions, and projection holds.
2. **Tool-loop projection removes the in-flight tool exchange** (it is after the anchor), so the model may
   re-request the tool; the attempt cap (100) bounds this. The contract mandates conservative removal.
3. **`summary` purpose** — *corrected by the corrective turn above*: the original text said the purpose was unbound
   and title generation was bound as `answer`. That was wrong: title generation (`ensureTitle`) is an existing
   derived provider call and is now bound as `summary` on every branch; compaction remains `compaction`.
   `SessionSummary.summarize` still makes no provider request.
4. **OAuth `instructions` projection/overlay is implemented and unit-tested only**; no actual OpenAI-OAuth
   request was run. The GitLab workflow model path always holds for managed SDKs.
5. **Storage handles** — *resolved by the corrective turn above*: the original text described a private duplicate
   Storage handle in the route handler. `server.ts` now provides the existing `Storage.defaultLayer`, the handler
   uses `Storage.Service`, and `makeGuardStorage` was deleted; the LLM layer consumes the provided service.
6. **The retained Sol diagnostic file must be updated by Sol** to dispatch its MCP tool (lazy default).
7. Not proved: any real cross-process API↔fork exchange, API-side decisions/persistence/result hydration,
   provider-specific schema behavior beyond the synthetic OpenAI-compatible provider, installed/live behavior.
   No automatic body is activated by this change; with no trusted integration or record nothing changes.
8. GitNexus: runner/tools unavailable in this session ⇒ impact analysis UNKNOWN (manual trace of
   `LLM.stream` callers: `processor.process` for answer/compaction and `ensureTitle`).
