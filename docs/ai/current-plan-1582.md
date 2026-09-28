---
date: 2026-09-24
repo: rhythm
branch: mega/2026-09-18-mobile-electron-hermes
base: e93eac6e
issues: [1582, 1565, 1553, 1554]
status: planning (design gate — awaiting Astra review before coding)
tags: [plan, rhythm, electron, transcript]
---

# Plan — #1582 Electron session transcript: OpenCode-Desktop streaming, live thinking, readable timestamps

## Goal

Make the Electron (`apps/web`) live session transcript reduce engine events with
OpenCode Desktop's proven message/part semantics so text, reasoning, tools and
decisions stream in order into one stable part each, scroll behaves like
OpenCode Desktop, and timestamps render through #1565's shared local formatter.

## Constraints

- Planning only; no product code in this pass. Coding agent: GPT-6 Sol after Astra review.
- Renderer-only fix preferred (`apps/web`). No api_server wire change unless the
  renderer cannot recover identity from the existing frames.
- Do not copy the OpenCode app. Port the minimum reducer semantics with attribution
  (`apps/opencode_fork` is vendored upstream v1.14.49; MIT).
- #1565 owns the shared timestamp formatter; #1553 owns empty-reasoning/summary/markdown;
  #1554 owns the usage footer. #1582 consumes, does not duplicate.
- Keep permission/question security boundaries (`pending-decisions`) and Rhythm child
  navigation (`children` block → `openLiveChildSession` by SDK id) intact.
- Real-engine sandbox qualification required (`tools/dev/sandbox.sh`), never a hand-rolled api_server.

## Investigation findings (root causes, with refs at e93eac6e)

1. **Live `message.part.updated` is dropped entirely (primary bug).** The bridge broadcasts
   `{v:1,type:'message.part.updated',id:<localId>,part}`. It has no top-level `messageId`/`partId`
   (`apps/api_server/src/services/opencode_stream_bridge.ts:1457-1462`, and the media
   rebroadcast at `:1422-1427`). Flutter reads `part.messageID`
   (`apps/desktop_flutter/lib/features/agents/models/agent_ws_message.dart:311-323`). The web store
   requires `event.messageId && event.partId` (`apps/web/src/store.tsx:500`), so the branch never runs.
   The web tests use an invented shape instead: `apps/web/tests/electron-e25a-transcript.spec.ts:63,75`
   and `tests/post-m1-phase-4-session-lifecycle.live.redspec.ts:213`. The mocks drifted from the real contract.
2. **Reasoning therefore streams as answer text, or not at all.** With no part snapshot, every
   `message.part.delta` for an unknown part becomes a `markdown` block (`store.tsx:476-497`).
   The engine sends `field:"text"` for reasoning deltas too (`opencode/src/session/processor.ts:279-290`).
   Every 2 s the REST snapshot turns that block into a `reasoning` `<details>`, which is collapsed by
   default (`Transcript.tsx:27`). Later deltas grow invisibly inside it.
3. **A REST snapshot replaces the transcript every 2 s.** `reconcileMembership` runs on
   `setInterval(…, 2000)`, then calls `detail()` and `replaceLiveSession`
   (`store.tsx:392-429, 320-331`), and messages are replaced wholesale. The WS and HTTP connections
   race each other. A delta broadcast after the DB read but applied before the response is lost until
   the next poll; this is the "disappearing" text. A delta broadcast before the read but delivered
   after the response is appended twice; this is the "duplicated" text. The same replacement also
   drops older-paged messages and resets `transcriptCursor`. `mergeMetadata`/`toSessionViewModel`
   wipes the cursor on every `session.updated` (`gateway/sessions.ts:378-379`).
   `loadOlder` prepends without de-duplicating by id (`store.tsx:995-1010`).
4. **The optimistic user row is never reconciled.** The `local-user-<ts>` row (`store.tsx:804-814`)
   disappears only when a wholesale replace happens. Its key changes at that moment, so the row
   remounts and the scroll anchor jumps.
5. **`message.part.removed` and `session.compacted` are not handled** in the web store, although the
   bridge relays both (`bridge:1638-1659, 1958-1972`).
6. **Scroll fights the reader.**
   - `useLayoutEffect` with no deps calls `restore()` on every render (`Transcript.tsx:266-276`).
     For an unpinned reader this rewrites `scrollTop` on every delta, which kills macOS trackpad momentum.
   - A reader who is pinned escapes only by moving more than 48 px in a single scroll event (`:252`).
     Small upward wheel steps snap back to the bottom.
   - "New output" is based on object identity (`:270`). The 2 s replace creates new objects, so the
     button appears even when nothing new arrived.
7. **Timestamps.** `Transcript.tsx:341` renders the raw ISO string. `mapMessage` falls back to the
   epoch (`new Date(0)`, `sessions.ts:315-316`). A placeholder message uses the client's current time
   (`store.tsx:494,518`).
8. **Interruption.** On abort the engine sets the assistant `info.error.name = "MessageAbortedError"`.
   It publishes `session.error` *before* the cleanup snapshots and the final `message.updated`
   (`processor.ts:732-829`, `message-v2.ts:1109-1114`). The bridge turns this into an `error` frame
   and persists a `system` "Error: …" row (`bridge:2075-2150`). The renderer shows none of the
   message-level interruption.

## Prior art (vendored v1.14.49 + upstream since)

- **OpenCode Desktop reducer** (`packages/app/src/context/global-sync/event-reducer.ts:184-294`):
  - messages are kept per session and parts per message, each sorted by id with a binary-search upsert;
  - `part.updated` replaces the part wholesale and clears its delta buffer;
  - `part.delta` appends to `part[field]` and is **dropped when the part is unknown**;
  - snapshot/delta ordering is protected only by a 16 ms coalescing queue (`global-sdk.tsx:57-91`).
  - It is bound to Solid (`setStore`/`produce`/`reconcile`), so it cannot be imported. The portable
    core is about 150 lines. There is **no `part.delta` test upstream**.
- **CLI reducer** (`packages/opencode/src/cli/cmd/run/session-data.ts`):
  - `syncText` (`:434-446`): a snapshot never erases longer buffered text.
  - It buffers deltas that arrive before the role or the part is known, then replays them
    (`:416-432, 569-607, 760-762`).
  - An interrupted turn gets exactly one final entry per live part (`:650-667`).
  - These semantics fill the reducer gaps above.
- **Auto-scroll** (`packages/ui/src/hooks/create-auto-scroll.tsx:21-203`):
  - an upward wheel (`deltaY<0`) unpins at once;
  - `markAuto`/`isAuto` ignore scroll events the hook caused itself (within 1500 ms and 2 px);
  - it re-pins within 10 px of the bottom;
  - a ResizeObserver follows content growth only while pinned;
  - `overflow-anchor` is `none` while pinned and `auto` otherwise;
  - the jump button shows when the distance exceeds `max(400, clientHeight)`.
- **Reasoning UI** (`ui/src/components/message-part.tsx:1524-1541`, `session-turn.tsx:116-150`):
  - empty or whitespace text renders nothing;
  - a headline comes from the first heading or bold-only line;
  - reasoning is hidden by default (`showReasoningSummaries=false`).
- **Upstream since vendoring** (tag 2026-05-13):
  - `#32331` added a 16 ms flush with delta coalescing, plus virtualization and a markdown worker
    (virtualization is out of scope);
  - `#41001` orders messages by `time.created + id` because v2 ids stopped being time-sortable.
    v1.14.49 ids are still ascending, so id order is correct for this fork (see the `ponytail:` note in S1).

## Design (gate: Astra review stands in for AJ approval; no coding before approval)

### Approaches

| | Approach | Trade-off |
|---|---|---|
| A | Patch `store.tsx` inline: read `part.messageID/id`, stop the 2 s replace | Smallest diff (~40 lines). The reconciliation rules stay implicit and untestable without a browser, and the hydration race (#3) survives. |
| **B (recommended)** | Port the OpenCode Desktop reducer semantics, with the `session-data` `syncText`/buffering rules, into one pure module over Rhythm's existing view model (`RichTranscriptMessage[]`). Periodic snapshots merge instead of replace, events are flushed in 16 ms batches, and the scroll logic becomes a hook ported from `create-auto-scroll` | About 250 new lines + 120 changed. It gives one tested boundary; `Transcript`, copy/revert/fork and child navigation are unchanged. |
| C | Embed the OpenCode Solid components in a Solid island | Rejected. It pulls in the Solid runtime, i18n/theme, the markdown worker and the global-sync SDK, which expects direct engine SSE. Direct engine SSE **bypasses the bridge's tool-deny backstop** (#736, `bridge:1406-1414`), `pending-decisions` and `SafeMarkdown`, and breaks child navigation. |

Variant B′ was considered and rejected: an OpenCode-shaped normalized store (`{info}` + `part[messageID]`)
with view models derived at render time. It is more faithful, but it rewrites every `session.messages` consumer.

### Chosen architecture (B)

- **`apps/web/src/gateway/transcript-reducer.ts`** (new, pure TS, attribution header
  `Ported from sst/opencode v1.14.49 (MIT)` with the upstream paths). The API is frozen so S2 can
  start in parallel:
  ```ts
  export type TranscriptState = { messages: RichTranscriptMessage[]; pending: Record<string, { messageId: string; text: string }> };
  export function applyTranscriptEvent(state: TranscriptState, event: SessionWireEvent): TranscriptState; // returns `state` unchanged (same ref) when no-op
  export function mergeTranscriptPage(state: TranscriptState, page: RichTranscriptMessage[], opts: { hasMore: boolean; mode: 'merge' | 'replace' }): TranscriptState;
  export function settleTranscript(state: TranscriptState): TranscriptState; // on idle: drop pending deltas + leftover optimistic rows, clear `streaming`
  ```
- **Store (`store.tsx`)**:
  - `onEvent` pushes frames onto a queue that a `setTimeout(16)` flush drains. It uses
    `setTimeout`, not rAF, so a hidden window still drains, and React 18 batches each flush into one
    render. Order is preserved across *all* frame types.
  - Transcript frames go through `applyTranscriptEvent` for **every** session, because the WS
    broadcasts to all clients (`ws_gateway.ts:191-202`) and background sessions must keep reducing.
  - Every periodic, idle, select, reconnect or `session.compacted` fetch uses
    `mergeTranscriptPage(mode:'merge')`. Explicit lifecycle actions (revert/unrevert/fork/summarize)
    use `mode:'replace'`.
- **Transcript** consumes blocks unchanged, plus a `streaming` flag on blocks and `interrupted` on
  messages. Scroll moves to `useTranscriptScroll`.
- **Security boundaries are untouched.** Permission and question cards stay in `pending-decisions`,
  docked after the transcript as in OpenCode. The tool part that triggered a decision updates in place.

### Data model, identity and order rules (the reducer contract)

| Concern | Rule |
|---|---|
| Message identity | SDK message id: `info.id`, `part.messageID`, `event.messageId`, or REST `sdkMessageId`. `idOf` coercion as today. |
| Part identity | SDK part id: `part.id` or `event.partId`. The REST fallback `${messageId}-${index}` applies to legacy rows only. |
| Message order | Legacy numeric REST rows first, in REST order. Then engine `msg_*` ids ascending (matches vendored `Binary.search` by id). Then optimistic `local-user-*` rows by send time. `ponytail:` switch to upstream `time.created+id` (#41001) when the fork syncs past it. |
| Part order | `prt_*` ids ascending; otherwise insertion order (legacy only). |
| `message.updated` | Upsert info (role, createdAt from `info.time.created`, cost/tokens, `interrupted = info.error?.name==='MessageAbortedError'`) and keep blocks. A confirmed `user` message removes the oldest optimistic row whose text equals its first text part. |
| `message.part.updated` | `messageId=part.messageID`, `partId=part.id`. An unknown message gets a placeholder (`role:'assistant'` until `message.updated` corrects it). **Final** snapshots replace wholesale: text/reasoning with `time.end`, tool `completed`/`error`, and every other type. A **non-final** text/reasoning snapshot keeps the local `content` when it starts with the snapshot text (session-data `syncText`) and takes every other field. Pending deltas for the part are folded in with an overlap merge (longest snapshot suffix that is a prefix of the buffer). |
| `message.part.delta` | Only `field==='text'` (`message-v2.ts:558-567`). A known part has the delta appended to `content`. An **unknown part buffers the delta in `pending`** and renders nothing, which fixes reasoning rendered as answer text. The buffer is folded in by the next snapshot or page, and dropped by `settleTranscript`. |
| `message.part.removed` / `message.removed` | Remove by id (handle the frames that are missing today). |
| Interruption | The message gets `interrupted:true`. A tool `error` part with `metadata.interrupted===true` gets meta `Interrupted`. Partial reasoning/text is kept. On `session.status working:false`, `settleTranscript` clears `streaming`. |
| Error | `error` frame → session status/`statusMessage` as today. No empty reasoning placeholder is ever synthesized. |
| Merge-mode page | Per message: REST info wins, except that an existing `info.time.created` is not overwritten by the DB row time. Parts use the same final/non-final rule as a live snapshot. A local part missing from REST is kept only if its id is greater than REST's max part id for that message. A local message missing from the page is kept if it is older than the page's oldest message (when `hasMore`), newer than its newest, or optimistic; otherwise it is dropped. The cursor is updated only by the first hydration or by `loadOlder`. |
| Missing reasoning | Reasoning with no text renders nothing (#1553 rule): `""`, whitespace, or the literal `[REDACTED]`, which mapPart normalizes to `""` (session-data `:521`). This covers Anthropic redacted thinking (`processor.ts:257-309`). |
| Timestamps | `createdAt` is `''` when unknown (never the epoch). The label comes from the #1565 formatter. |

### Scroll behavior (`useTranscriptScroll`, ported from create-auto-scroll, keeping E52A contracts)

- **Pinned** (within 10 px of the bottom):
  - a ResizeObserver on the transcript sets `scrollTop = scrollHeight` after `markAuto`;
  - CSS `overflow-anchor: none`.
- **Unpins immediately** on:
  - an upward wheel (`deltaY<0`, ignored inside nested scrollers such as `pre`, until the nested scroller reaches its edge);
  - PageUp, Home or ArrowUp on the viewport;
  - any scroll event that is not auto (`isAuto` guard, within 1500 ms and 2 px).
- **Unpinned**:
  - never writes `scrollTop` on render;
  - restores the saved anchor only on session/child switch and older-page prepend (existing E52A c3/c5 behavior);
  - "New output" appears when a content signature changes (last message id + block count + last content length), not when object identity changes.
- **Jump**: repins, focuses the viewport, and hides the button (E52A c2).
- **Kept Rhythm deviation**: the per-session reading position is restored on return. OpenCode always
  resets to the bottom; Rhythm restores the reading position because E52A c5 is an accepted contract.
- `ponytail:` no 250 ms gesture gate. Programmatic `scroll` events must still unpin because E52A
  drives them. Upgrade to the gate if a layout shift is ever seen to unpin a pinned reader.

### Reasoning presentation (S4, after #1553)

- A `<details>` in `Transcript.tsx` with a stable key (the part id).
- Its initial `open` is set on first mount: open if the block is `streaming`, otherwise open only if
  the content is ≤ 600 chars.
- A user toggle is recorded in a module-level `Map<partId, boolean>` (workspace lifetime, like
  `positions`), and wins from then on. No auto-collapse at completion, so there is no layout shift.
- The summary shows `Thinking…` plus the live #1553 headline while streaming, and the headline
  (fallback "Reasoning") when final.
- Subordinate styling: `--fg-2`, 13 px, a left rule, and no animation under `prefers-reduced-motion`.
- The streaming `article` gets `aria-busy="true"`. The transcript stays non-live (E52A asserts no
  `aria-live`).
- The interrupted message gets a neutral "Interrupted" marker, not `role=alert`.

### Timestamps (owned by #1565; #1582 states the transcript contract)

The minimum #1565 must expose for the transcript:
- **Label**: same local day `1:01 PM`; `Yesterday, 4:12 PM`; same year `Sep 21, 1:01 PM`; older
  `Sep 21, 2025, 1:01 PM`.
- **Full text**: `Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'})`.
- **Invalid input** returns `null`.
- **No relative "2m ago"** in the transcript, because it would need a ticking re-render.

Markup: `<time dateTime={iso} title={full}><span aria-hidden="true">{label}</span><span className="sr-only">{full}</span></time>`.
For an invalid value: `<span className="message-time-missing">Time unavailable</span>`, with no `dateTime`.
#1565's inventory already includes `Transcript.tsx:341`, so **#1565 edits that line**. #1582
only asserts it (S5 = verification, plus a gap-fill only if #1565 ships without full text or the fallback).

### User journeys

| Job | Entry point (Electron shipping renderer `rhythm://app/index.html#/agents`) | Visible success | Slice |
|---|---|---|---|
| Watch the agent think | Agents → session → send | A Thinking block appears and grows while Working; the answer follows below it | S1, S2, S4, S6 |
| Read back while it streams | Wheel up during streaming | View and focus stay put; "New output" appears; clicking it returns to the bottom | S3, S6 |
| Switch away mid-turn and return | Rail → other session → back | The same parts, no duplicates or gaps, and the live stream continues | S1, S2, S6 |
| Stop a turn | Stop | One assistant message keeps its partial reasoning/text and is marked Interrupted | S1, S4, S6 |
| Answer a permission mid-turn | Permission card | The card resolves and the tool row updates in place | S2, S6 |
| Know when a message was sent | Message header | `1:01 PM` / `Yesterday, 4:12 PM`, with the full time for screen readers and on hover | #1565, S5, S6 |

Non-goals:
- The live child transcript stays a one-shot fetch (`openLiveChildSession`); reopening refreshes it.
- Virtualization.
- Paced character reveal (`ponytail:` add `usePacedValue` from `message-part.tsx:161-246` if chunky deltas look jumpy).
- Server-side abort classification (see follow-up F1).

### Doubt review

**What would make this wrong?**
- REST mirror parts might lack `id`/`time.end` in real data, which would misclassify parts as final
  or non-final.
- Frames might reach the renderer out of engine order.
- The scripted provider might not produce `reasoning_content` through the bundled
  `@ai-sdk/openai-compatible` (`provider/provider.ts:100`).

**Cheapest probe (S0):** in the sandbox, capture WS frames and `GET /agent-sessions/:id?transcriptLimit=50`
both mid-turn and after it, and check the parts. Primary sources checked: the bridge, the repo mirror
(`upsertPart` stores the engine part verbatim, `agent_session_messages_repository.ts:285-336`), the
engine processor, and the engine's own test LLM server wire shape (`test/lib/llm-server.ts:92,302`).

## GitNexus impact (index: `.mega-wt/integration`)

| Symbol | Risk | Direct callers | Note |
|---|---|---|---|
| `mapPart` (`gateway/sessions.ts`) | LOW | 2 (`mapMessage`, store `onEvent`) | S1 adds the `streaming` flag, `[REDACTED]` normalization, and the interrupted tool meta |
| `mapMessage` | LOW | 2 (`toSessionViewModel`, `pageOlder`/`childMessages`) | S1 changes the createdAt fallback from the epoch to `''` |
| `reconcileMessageInfo` | LOW | 1 (store) | S1 folds it into the reducer, or keeps it |
| `Transcript` | LOW | 1 (`AgentsWorkspace`) | S3/S4/S5 |
| `FixtureProvider` (store) | LOW per graph; treat as MEDIUM (every page reads `useFixtures`) | — | S2 is scoped to the live `useEffect` and `loadOlder`/`sendLiveInput` |
| `OpencodeStreamBridge._relayEvent` | **HIGH** (3 processes: resume/fork/create) | 2 | **Not touched.** This is why the fix stays renderer-only. |

## File structure map

| File | Responsibility | Slice |
|---|---|---|
| `apps/web/tests/live/scripted-openai-provider.mjs` (new) | ~50-line OpenAI-compatible `/v1/chat/completions` SSE server. It picks the script from the request's `model` field: `reasoner` sends `reasoning_content` chunks then `content`, 150 ms apart, matching the wire shape at `llm-server.ts:92`; the others are `plain`, `tool` (bash call), `question`, `hang` and `error500` | S0 |
| `apps/web/tests/live/capture-transcript-frames.mjs` (new) | Against sandbox API 4098:<br>1. `POST /agent-sessions`, then `PATCH` with `providerId:'rhythm-scripted'` and `modelId:<script>`.<br>2. Open `ws://127.0.0.1:4098/ws/agents` and send `session.input`.<br>3. Drive the actions: `POST …/cancel` after 3 reasoning deltas (`hang`), the permission/question reply APIs (`tool`/`question`), and `POST …/summarize` (F13).<br>4. Save the mid-turn and final `GET …?transcriptLimit=50`.<br>5. Write sanitized JSONL. | S0 |
| `apps/web/tests/fixtures/transcript/*.jsonl` (new) | Real captured frame sequences (see fixtures) | S0 |
| `apps/web/src/gateway/transcript-reducer.ts` (new) | Pure reducer, merge and settle | S1 |
| `apps/web/tests/contract/issue-1582-transcript-reducer.test.mjs` (new) | `node:test` replay of the fixtures plus derived reorderings. It loads the TS module through Vite `createServer({server:{middlewareMode:true},appType:'custom'}).ssrLoadModule('/src/gateway/transcript-reducer.ts')`, the pattern in `tests/contract/issue-1447-gateway.test.mjs`. Plain `--experimental-strip-types` cannot resolve the extensionless `./sessions` import. | S1 |
| `apps/web/src/gateway/sessions.ts` | `mapPart` (`streaming`, `[REDACTED]`, interrupted meta); `mapMessage` (createdAt `''`, `interrupted`) | S1 |
| `apps/web/src/types.ts` | Optional `streaming?`, `interrupted?`, `Session.transcriptPending?` | S1 |
| `apps/web/src/store.tsx` | 16 ms queue; reducer wiring; merge-mode hydration; cursor preservation; `loadOlder` merge; `session.compacted`; remove dead `streamedPartsRef` | S2 |
| `apps/web/tests/electron-e25a-transcript.spec.ts`, `tests/post-m1-phase-4-session-lifecycle.live.redspec.ts` | Replace the invented `{messageId,partId,part}` frames with the real `{id,part}` shape | S2 |
| `apps/web/src/components/useTranscriptScroll.ts` (new) | Scroll hook | S3 |
| `apps/web/src/components/Transcript.tsx` | Scroll wiring (S3); reasoning details, interrupted marker, memoized `MessageRow` (S4); `<time>` verification (S5) | S3→S4→S5 |
| `apps/web/src/components/Transcript.css` | Reasoning subordinate style, `overflow-anchor` toggle, interrupted marker | S3/S4 |
| `apps/web/tests/electron-e52a-transcript.spec.ts` | Add real-wheel cases | S3 |
| `apps/web/tests/electron-e52b-playwright.config.ts` + `electron-e52b-live-transcript.spec.ts` (new, mocked live mode, port 4194) + `electron-e52b-live.spec.ts` (`RHYTHM_LIVE_E2E=1`, sandbox 4098/4097) | Replay of fixtures in the browser, plus real-engine qualification | S4/S6 |
| `apps/web/tests/run-electron-slices.mjs` | Add `'52b'` | S4 |
| `docs/ai/contracts/issue-1582.json` (criteria `issue-1582-c1…c12` = coverage-matrix rows), `docs/ai/runs/<S6-run-date>-issue-1582-live-transcript.md`, `docs/ai/runs/artifacts/issue-1582/*.png` | Contract, evidence, screenshots | S6 |

## Reducer fixtures

Captured in S0 from the real engine and bridge. Derived fixtures are reorderings of captured frames,
never invented shapes.

| ID | Source | Sequence → expected |
|---|---|---|
| F1 reasoning-text | captured (`reasoner`) | reasoning `""` → ≥5 deltas → reasoning final `time.end` → text `""` → deltas → text final → step-finish → `message.updated` → `session.status working:false`. **Expect** one assistant message with blocks `[step-start, reasoning, text, step-finish]` in id order, whose reasoning/text equal the final snapshots exactly. |
| F2 delta-before-snapshot | derived from F1: drop the reasoning start snapshot; the first 3 deltas arrive first; then a page whose part holds deltas 1–2 | Content equals the engine final text, and no delta substring appears twice. |
| F3 stale non-final snapshot | derived: re-insert the start snapshot (`text:""`) after 6 deltas | Content is not shortened. |
| F4 hydration race ± | derived: page older than local, and page newer than local, mid-stream | Neither case loses or duplicates text; the page's part ids are a subset of the result. |
| F5 tool + permission | captured (`tool` script → bash, `permissionMode:'default'`) | pending → running → `permission.asked` → reply → completed. **Expect** one tool block updated in place, with the permission only in `pending-decisions`. |
| F5b question | captured (`question` tool) | `question.asked` → answer → `question.resolved`; the tool block updates in place. |
| F6 interrupted | captured (`hang` script, cancel mid-reasoning) | `error` frame → cleanup snapshots → `message.updated` `MessageAbortedError` → idle. **Expect** exactly one assistant message, reasoning preserved, `interrupted:true`, no `streaming` flags. |
| F7 provider error | captured (`error500`) | `error` frame. **Expect** status `error` and no empty reasoning block. |
| F8 non-reasoning | captured (`plain`) | No reasoning block; order is user < assistant. |
| F9 redacted reasoning | captured if the provider supports it, else derived from F1 with an empty/`[REDACTED]` text | Block content `''`; the renderer shows nothing. |
| F10 optimistic user | derived: optimistic `local-user-*` then the confirmed user message | Exactly one user row. |
| F11 background session | captured F1 applied while another session is selected, then a merge page | Result equals the REST final (deep-equal content by part id). |
| F12 older-page retention | derived: `loadOlder` page, then 3 periodic merges | Older messages retained, cursor unchanged, ids unique. |
| F13 compaction | captured (`summarize`) | Compaction part in order; the `session.compacted` merge causes no duplicate. |
| F14 removals | derived | `message.part.removed` and `message.removed` delete exactly one item each. |

## Issue table

Branch: worktree `/private/tmp/rhythm-swarm-1582` on `swarm/issue-1582` from `e93eac6e`, the
existing swarm convention. Draft PR into `mega/2026-09-18-mobile-electron-hermes`; no merge.

| # | Title | Likely files | Acceptance criteria (falsifiable) | Depends on | Required validation | Parallel? |
|---|---|---|---|---|---|---|
| S0 | Capture real engine transcript sequences | `tests/live/scripted-openai-provider.mjs`, `tests/live/capture-transcript-frames.mjs`, `tests/fixtures/transcript/*.jsonl` | (1) Each JSONL frame is a verbatim bridge frame. Every `message.part.updated` has `part.id` and `part.messageID` and **no** top-level `messageId`. (2) F1 holds ≥5 reasoning deltas between a reasoning snapshot with `text:""` and one with `time.end`. (3) F6 holds `info.error.name==="MessageAbortedError"`. (4) A mid-turn and a final REST detail are saved beside F1, and their parts carry `id` and `time.start`/`time.end`. (5) Paths and cwd are sanitized to `/sandbox/project`; `rg -n "ajhochhalter\|sk-\|Bearer" tests/fixtures/transcript` is empty. | Sandbox fixture root (operator-sanitized DB and opencode config with a `rhythm-scripted` provider block) | `tools/dev/sandbox.sh up` → `node tests/live/scripted-openai-provider.mjs --port 4196 &` → `node tests/live/capture-transcript-frames.mjs --api 4098 --script reasoner --out tests/fixtures/transcript/f1-reasoning-text.jsonl` (repeat per script) → `tools/dev/sandbox.sh down`; frame counts in the run log | Yes (tests only) |
| S1 | Pure transcript reducer (OpenCode semantics) | `src/gateway/transcript-reducer.ts` (new), `tests/contract/issue-1582-transcript-reducer.test.mjs` (new), `src/gateway/sessions.ts` (`mapPart`/`mapMessage`), `src/types.ts` | F1–F14 pass exactly as specified above. `applyTranscriptEvent` returns the identical `state` ref for unknown or no-op frames. Untouched messages keep reference identity (asserted with `===`). The attribution header is present. | Frozen API above; S0 fixtures. If S0 is blocked, write synthetic F-fixtures from `processor.ts` semantics and swap in the captured ones before S6. | `cd apps/web && node --test tests/contract/issue-1582-transcript-reducer.test.mjs` (all pass); `npm run typecheck` | Parallel with S3 |
| S2 | Wire the reducer into the live store; merge-mode hydration | `src/store.tsx`; fix the invented shape in `tests/electron-e25a-transcript.spec.ts:63,75` and `tests/post-m1-phase-4-session-lifecycle.live.redspec.ts:213` | (1) A real-shape `message.part.updated` updates the block (e25a c7 green with `{id,part}`). (2) After `loadOlder`, three 2 s reconciles keep the older messages and `transcriptCursor` (e52a c3 plus a new assertion). (3) A 2 s reconcile during a stream never shortens a streaming block (e21 c4 extended: content length is monotonic across 5 polls). (4) One user row after send and confirm. (5) `message.part.removed` and `session.compacted` are handled. (6) There is no `streamedPartsRef`. (7) The boundaries are unchanged: the e25a child-view test still opens by SDK id, and the e24 decision specs (permission/question cards) pass without edits. | S1 (merge after S1) | `npm run typecheck`; `npx playwright test -c tests/electron-e25a-playwright.config.ts`; `-c tests/electron-e21-playwright.config.ts`; `-c tests/electron-e24-playwright.config.ts`; `-c tests/electron-e52a-playwright.config.ts`; `-c tests/post-m1-phase-4-live-playwright.config.ts` | Starts against the frozen API; merges after S1 |
| S3 | OpenCode-style scroll hook | `src/components/useTranscriptScroll.ts` (new), `src/components/Transcript.tsx` (scroll section only), `Transcript.css`, `tests/electron-e52a-transcript.spec.ts` | (1) E52A c1–c5 stay green. (2) New c6: while deltas stream every 50 ms, one `page.mouse.wheel(0,-60)` unpins (`gap` > 40 after 1 s) and "New output" becomes visible. (3) New c7: with the reader unpinned and no new frames, three 2 s reconcile cycles do not show "New output". (4) New c8: while unpinned, 20 streamed frames do not write `scrollTop` (checked by instrumenting a setter spy through `page.evaluate`). (5) Wheeling inside an overflowing tool `pre` does not unpin until the `pre` reaches its top. | none (disjoint from S1/S2) | `npx playwright test -c tests/electron-e52a-playwright.config.ts` | Parallel with S1 |
| S4 | Live reasoning view, interruption marker, memoized rows | `src/components/Transcript.tsx` (`RichBlock` reasoning branch, `MessageRow` memo), `Transcript.css`, `tests/electron-e52b-*` (new), `tests/run-electron-slices.mjs` | Checked by the mocked e52b replaying F1 at 150 ms: (1) `.reasoning-block` text length strictly increases at ≥2 samples before the `session.status working:false` frame is sent. (2) While streaming the block is `open` and its summary contains `Thinking`. (3) After the user collapses it, 5 more deltas leave it collapsed; after expanding, it stays open through completion. (4) A final reasoning block over 600 chars, loaded from REST, starts collapsed. (5) F8/F9 render zero `.reasoning-block`. (6) The F6 message shows `Interrupted` and has one assistant `article`. (7) A delta to message N re-renders only row N (React Profiler or a render-count probe). (8) axe finds no serious or critical issue on `[data-testid=transcript]`. Screenshots `thinking-streaming.png` and `thinking-final.png`. | S1, S2, **#1553 merged** (empty suppression, headline, SafeMarkdown) | `npx playwright test -c tests/electron-e52b-playwright.config.ts`; `npm run build && npm run test:dist-smoke` | After S3 (same file) |
| S5 | Transcript timestamp verification | `tests/electron-e52b-live-transcript.spec.ts` (assertions); `Transcript.tsx:341` only if #1565 left a gap | (1) No visible text in `[data-testid=transcript]` matches `/\d{4}-\d{2}-\d{2}T\d{2}:/`. (2) Every `time[datetime]` parses to a valid ISO string. (3) Under `timezoneId:'America/Los_Angeles'`, a message at `2026-09-21T20:01:40Z` shows `1:01 PM`. (4) The accessible text contains `September 21, 2026`. (5) `createdAt:''` renders `Time unavailable`, no `time` element and no crash. | **#1565 merged**; S1 (`''` fallback) | Same e52b run with `test.use({ timezoneId: 'America/Los_Angeles' })` | After S4 |
| S6 | Real-engine sandbox qualification and evidence | `tests/electron-e52b-live.spec.ts`, `docs/ai/contracts/issue-1582.json`, run log, `docs/ai/runs/artifacts/issue-1582/` | Against the sandbox with the scripted provider, driving the real composer: (1) Reasoning DOM text grows at ≥2 samples while the session status is Working and before the final text snapshot. (2) After completion, the DOM part texts deep-equal REST `GET …?transcriptLimit=50` parts by id. (3) Switching to another session mid-turn and back leaves no duplicate or missing part ids against REST. (4) Stop mid-reasoning gives one assistant message with the reasoning kept and `Interrupted` shown. (5) The `plain` model shows no reasoning block. (6) There is no raw ISO text. (7) Screenshots: streaming, final, user-collapsed, new-output, timestamps, interrupted. | S0–S5 | Fork build and sandbox via `tools/dev/sandbox.sh up` (never a hand-rolled api_server); `RHYTHM_LIVE_E2E=1 npx playwright test -c tests/electron-e52b-playwright.config.ts`; `tools/dev/sandbox.sh down`; the exact output recorded in the run log | No |

### Dependencies and order

- **#1565** (formatter, and the `Transcript.tsx:341` swap) and **#1553** (reasoning empty,
  headline and markdown, done at render time in `RichBlock` **without editing `mapPart`**) land
  independently, before S5 and S4 respectively.
- The frozen API lets S1 and S2 start in parallel; S2 merges after S1.
- S3 runs in parallel with S1/S2.
- S4 follows S3, S5 follows S4, and S6 follows all of them.
- **#1554** owns `MessageUsage` (`Transcript.tsx:21-23`) and needs no #1582 change. The only risk
  is a trivial hunk conflict.
- PR #1577 (#1552) edits `styles.css` child-chip rules. #1582 styles go only in `Transcript.css`.

### Coverage matrix (#1582 acceptance criteria → slice → criterion → validation)

| #1582 AC | Slice | Falsifier | Validation |
|---|---|---|---|
| Incremental reasoning from live deltas | S1, S2, S4, S6 | S4 (1), S6 (1) | e52b mocked + live |
| Delayed snapshots never erase | S1, S2 | F2, F3, F4; S2 (3) | node:test, e21 |
| Stable order and one part per id for text, reasoning, tool, permission, question, compaction, interruption | S1, S2 | F1, F5, F5b, F6, F13, F14 | node:test, e25a |
| No fake empty thinking | S1, S4 | F8, F9; S4 (5); S6 (5) | node:test, e52b |
| Readable, subordinate, collapsible, user state preserved | S4 | S4 (2)–(4), (8) | e52b + axe |
| Session switch restores without dup/missing | S1, S2, S6 | F11; S6 (3) | node:test, live |
| OpenCode-style scroll and new-output | S3 | S3 (1)–(5) | e52a |
| Shared local formatter, dateTime, accessible full text | #1565, S5 | S5 (1)–(4) | e52b |
| Invalid timestamp fallback | S1, S5 | S5 (5) | e52b |
| Reducer tests replay real sequences (reasoning-before-snapshot, interrupt, error) | S0, S1 | F1–F7 from captured JSONL | node:test |
| Playwright live thinking + readable timestamps | S4, S5, S6 | S4 (1), S5 (1), S6 (1)/(6) | e52b |
| Real-engine sandbox qualification | S6 | S6 all | `RHYTHM_LIVE_E2E=1` |

## Open questions (safe defaults applied; none block Astra's review)

1. The per-session reading position is kept on return, instead of OpenCode's always-bottom.
   Default: keep (E52A c5).
2. Reasoning is shown by default; OpenCode hides it by default. Default: show, collapsed for long
   history. Suggest a follow-up setting only if AJ asks.
3. Transcript timestamps are absolute and concise, with no relative "ago". Default applied; this is
   passed to #1565 as its transcript contract.
4. **F1 (follow-up issue, not #1582):** on user interrupt the bridge persists a `system`
   "Error: …" row and sets status `error` (`bridge:2075-2150`). Classifying `MessageAbortedError` as
   an interruption touches HIGH-risk `_relayEvent`. File it separately if the S6 evidence shows the
   duplicate row.
5. **Sandbox prerequisites.** S0/S6 need the operator's sanitized fixture root and a
   `rhythm-scripted` provider entry in the read-only fixture `opencode.json`.
   UNVERIFIED: the sandbox guard (`sandbox.sh:204-266`) accepts a `provider` block.
   Fallback: the keyless `opencode/deepseek-v4-flash-free` model
   (`docs/ai/contracts/zen-free-model-bootstrap.json` c3); whether it exposes reasoning is UNVERIFIED.
   S6 cannot be waived; if both paths fail, the PR stays draft with S6 marked BLOCKED.

## Context note

This planning pass consumed large exploration output. Give the coding agent a fresh dispatch that
carries only this file plus the issue bodies of #1582, #1553 and #1565.
