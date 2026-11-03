# Calendar and development-session context: bounded additive plan

Sol, read-only planning, 2026-10-06. These are two remaining original product-context gaps, not a new release gate on the coherent coordinator increment. No source edits, tests, live service, credentials, provider calls, or UI work were performed. Accepted lazy work and completed native/OpenDesign/UI baselines stay closed.

## Evidence and existing seams

References below are relative to the API source in the builder's `rhythm-mobile-canonical-backend-20261006/working`. The context contract and all ten underlying source files pinned below match the immutable `task4/core-sol-frozen-copy` reconstructed from base `5da2f764b5f240bb9650c58ce558a32aac2381e1` plus core patch `8d143183990f93481428091784332ec7022112a41c40ed34cc57133e136d4d3e`. The ongoing owner's service/server additions were read only to locate the newer callback seam; their mutable checkout was not modified or tested.

| Existing file / location | What it proves / reuse |
| --- | --- |
| `services/coordinator_conversation_context.ts:28,457,520` | Only tasks, schedules, rhythms, current-project workstreams/receipts and manualActivity are assembled. No calendar or development-session source exists. |
| `services/coordinator_conversation_runtime_adapters.ts:196,214` | Existing repository-backed adapters and bounded current-project workstream scan. Keep those scopes unchanged. |
| `contracts/coordinator_conversation_contract.ts:233,262,410,417,439` | Availability and selected coverage are explicit. The existing qualified-read union requires a complete authoritative scoped observation; partial external sync must not be forced through that union as complete calendar truth. |
| `repositories/calendar_shadow_events_repository.ts:45,82` | Owner-filtered mirror exists, but owner argument is optional. Current range uses start-at BETWEEN, returns every matching row, and misses spanning events; owner replacement is transactional in SQLite. Event rows have no external account binding or sync receipt. |
| `services/integrations_service.ts:49,76,135,622` | Existing sync chooses accessible calendars, replaces the owner's mirror, then marks the account synced after downstream evaluation. Missing preferences means all accessible calendars; explicit empty selection means none; nonempty selection is intersected with accessible calendars. |
| `repositories/integration_accounts_repository.ts:87,123,290` | Exact owner/provider account and lastSyncedAt exist. Google reconnect can change external_account_id in the same account row while retaining last_synced_at and old mirror. Account id/lastSyncedAt alone cannot prove that mirror belongs to the currently connected Google identity. |
| `integrations/google_calendar/google_calendar_service.ts:26,81,89,114` | Existing sync fetches from sync time through 30 days, expands recurring instances, but reads one page per calendar; no nextPageToken/completeness receipt is retained. Last successful sync is not proof that all calendar events were captured. |
| `repositories/integration_preferences_repository.ts:137,159,192` | Owner-only selected-calendar preference read exists; malformed JSON collapses to null, so it cannot distinguish missing/default from corrupt configuration without a narrow qualified read. No selection-update timestamp is stored. |
| `repositories/agent_sessions_repository.ts:195,231,243,250,293,323` | Paged chat roots default to nonarchived/nonsystem; owner filter also includes NULL-owner legacy rows. It snapshots all matching IDs internally, then returns bounded pages, rechecks filters, and calculates child counts with the same legacy owner predicate. Do not describe its internal scan as bounded SQL or reuse child counts as strictly owned counts. |
| `server.ts:250` (frozen core) | ownerProjectAccess rejects missing/archived projects; accepts server-created owned coordinator provenance or an exact owned, nonarchived, nonsystem chat root. Generic project catalog presence is not an ACL. The latter proof looks at only 100 recent roots; false negatives must not become a claim that no other owned projects exist. |
| `controllers/agent_sessions_controller.ts:577` | Explicit history pagination is local SQLite only; default history omits archives, scheduled and self-improvement sessions. No new global-history behavior is needed. |
| `services/coordinator_conversation_model_status_service.ts:111` | Existing signed rhythm_get_coordinator_status binds current owner/project/root/native call; empty arguments only, final current-auth rechecks, 3,800-byte response bound. Reuse this tool. |
| Current owner `services/coordinator_conversation_service.ts:2327,2381,2443,2515`; `server.ts:711`; `services/async_delegation_completion_service.ts:452` | Fresh callback assembler, shared foreground contract/fingerprint and status renderer already exist. Callback rechecks exact dispatched child/root/profile and the prepared fingerprint before enqueue. Extend these seams rather than inventing another callback path. |

## Smallest useful implementation

One serialized API/backend owner should add two optional, status-only projections in the existing contract, assembler and runtime adapters: `calendarMirror` and `projectSessions`. Optional sources must not join mandatoryModelContextIsQualified or make ordinary chat unavailable. Give each its own provenance/freshness/window metadata rather than inventing complete totals in the existing complete-scan coverage type.

Calendar projection:

- Read exact owner Google Calendar account, exact owner preferences, and exact owner/provider mirror locally. Do not call ensureFreshAccount, settings discovery or sync from context; those refresh credentials, contact Google, or perform writes. Do not serialize tokens, account credentials, scope strings, description, location, or raw error bodies.
- Add a small read-only `CalendarShadowEventsRepository` window method instead of repurposing findByRangeAsync. Suggested window is today through the next seven local days in the existing coordinator America/Los_Angeles zone; cap selection at eight events with a one-row lookahead. Use normalized instants for timed-event overlap, local day keys and exclusive end dates for all-day overlap; order by normalized start then stable id. Never use raw ISO string ordering across offsets. An event spanning today is eligible; historical events omitted by the existing sync cannot be recovered by this reader.
- Return title (bounded/sanitized source data), start/end, allDay and a calendar label, plus window start/end, observedAt, lastSuccessfulSyncAt, sync age, selected count, hasMore and total=null when uncounted. Explicitly label this as owner-local mirror observations, external completeness unknown, current-account binding unproven. Eight absent observations means zero stored observations in that window, not “your calendar is clear.” A stored row timestamp is not a successful-sync timestamp.
- No account: not_configured, without exposing leftover mirror as current calendar. Error, never-synced, invalid/future sync timestamp, corrupt preference, failed read: unavailable or explicitly stale historical mirror, not a healthy empty calendar. Explicit empty selection: disabled by selection, not “no events.” Nonempty selection may filter old mirror to those ids, but selection freshness remains unknown; null preferences mean default-all at sync time, not proof of today's accessible calendars. Never relabel scheduled tasks as calendar events.
- Represent raw sync age even if a staleness policy is not yet approved. Do not invent a “fresh” TTL. Existing account status and lastSyncedAt qualify observed local sync state, not live Google authority. Re-read account identity/status/lastSyncedAt and selected-calendar configuration after awaited mirror reads; a change withholds the prepared projection. Fingerprint semantic source versions/content, not the ever-changing observedAt clock.

Development/project-session projection:

- Reuse listAgentSessionsPage with ownerUserId, scope=chats, no search, no project selector (cross-project read), and archives disabled. Suggested maximum: two existing 100-row pages, twelve selected roots. Strictly require row.ownerUserId===scope.ownerUserId before projecting anything; reject NULL-owner legacy rows. Stop and mark truncated/unknown coverage when the budget is exhausted or the cursor expires. Do not claim an exact total or all active sessions from a recent window. This preserves existing history semantics; it does not add a history endpoint or scan every project/workstream.
- For each selected row require a real, nonarchived project and the injected existing ownerProjectAccess/canOwnerAccess check. Group the selected summaries by project. Exclude the current Secretary root so it does not count itself as development work. Omit cwd, previews, messages, prompts, provider-account identifiers, permission settings, grants and resumable engine state. Output only bounded project/session labels, opaque local ids, persisted status and lastActivityAt/updatedAt, plus actual profileId/label if available.
- There is no generic “development session” bit in AgentSession. Use the honest label “project sessions,” preserving actual profile identity. The existing Coding Workflow dispatch uses exact profile id workflow-orchestrator; only that exact identity can be tagged Coding Workflow. Do not infer coding intent from a session title, agentKind, display label, project path, or every interactive chat. A missing/disabled/locked profile can still be historical owned status, clearly unavailable for execution; do not change its profile or switch the Secretary's active profile.
- Stored working/starting/error/idle/resumable/closed is persisted session state, not a live engine heartbeat, completion proof or goal verification. Closed does not mean success. Keep root status initially; inherited childCount/runningChildCount include NULL-owner children and are not qualified. If child summaries are later required, use the existing child pager with strict owner/project/root relation rechecks and its own bounded budget, not a new recursive tree.
- Recheck each selected row's exact owner/project/archive and project access at exposure, including after calendar awaits; fingerprint selected status/profile/project eligibility and content. Never turn a readable catalog entry into a cross-project dispatch target. Existing finite goal authorization, current-project workstreams, root plan mode and interactive child approval stay unchanged.

## Delivery into the existing persistent chat

Extend foregroundSystemContract's automatic server-generated snapshot with compact source state, last sync/observation age, selected counts and coverage limitations. Keep event/session bodies out of that system text. Extend modelStatusText, including its existing oversized fallback, with small calendar and project-session summaries and their qualifications. Maintain the 3,800-byte signed tool response and 8,000-byte context bounds; trim lower-priority items deterministically and mark selected coverage, never silently truncate JSON or hide unavailability.

The profile availability preface already says whether rhythm_get_coordinator_status is actually allowed. Add the narrow instruction to use that existing signed tool for current calendar/project-session questions when available; with no grant, use only the automatic qualified summary and state detail unavailable. Do not add a new grant, force a tool call, or make a write/send/sync tool available. Shared foregroundSystemContract/fingerprint and the accepted callback prepare/current seam naturally deliver the same fresh source states on both foreground and completion callbacks. Add both projections to the semantic fingerprint and final exposure rechecks. Do not persist event bodies as new system/history messages or cache a prior turn's status as current.

## Owner boundaries and meaningful verification later

Same serialized backend writer: contracts/coordinator_conversation_contract.ts, services/coordinator_conversation_context.ts, services/coordinator_conversation_runtime_adapters.ts, repositories/calendar_shadow_events_repository.ts, services/coordinator_conversation_service.ts, and narrow server.ts dependency injection/profile-preface lines. Integration account/preferences/service/Google connector and agent-session/history repositories remain read-only in the minimal plan. No web/mobile/engine/C3 relay changes, sync timer, schema/table, new connector, queue or orchestration layer. Implement only after Astra accepts the calendar authority choice below; do not overlap the current writer.

Use existing coordinator_context/runtime_adapters/service test files and existing synthetic local repository harness, adding only affected cases:

1. Calendar exact owner isolation; missing account, error, never synced, stale timestamp and explicit no-calendars selection remain distinct from an empty mirror. Account switch with preserved account id/lastSyncedAt never asserts current-account binding or complete Google emptiness.
2. Offset-equivalent timed starts, spanning events, exclusive all-day end and LA day boundary; nine candidates produce eight plus hasMore. One-page sync metadata remains externally incomplete even when its local query completes.
3. Cross-project owned root appears; foreign/NULL owner, archived session/project, missing project and failed ownerProjectAccess do not. Enough legacy/filtered rows to exhaust the scan yields truncated/unknown coverage, not authoritative empty; no SDK/provider calls occur.
4. Persisted working/closed and disabled/missing profile stay status observations without execution/completion assertions or body leakage. No legacy child counts are promoted.
5. Existing foreground + signed status + callback seam observes a source change; account switch/project archive/root revoke across awaits withholds stale exposure. Byte-bound fallback preserves both source qualifications, active tool grant remains unchanged, and the exact current-project execution gate still rejects cross-project dispatch.

No tests were added or run for this planning task. These are proposed affected checks, not newly opened baseline gates.

## Decision for Astra

Recommend accepting the minimal **owner-local calendar mirror observation** level now, with explicit current-account-binding and external-completeness unknown. It is useful context and makes no live-calendar claim. Existing sources cannot prove a complete empty current Google calendar, even immediately after a successful sync: account identity can change in-place, selection provenance is missing, pagination is unrecorded, and the sync time window starts at the fetch instant.

If the product requires calendar emptiness/current-account authority, this needs a separate tiny sync-path receipt, not a stronger adjective in the reader. At successful existing sync, record owner, external account identity, resolved selected calendar ids, exact fetched range, completion time and page-completeness into the existing owner integration-preference store (new key, no table/timer). Bind it to the actual replacement and recheck account/selection; without that proof the projection stays unqualified. Completing pagination would also be explicit connector work; no current receipt or lastSyncedAt can substitute. This follow-on must be separately accepted and owned, not a release block or scope expansion here. Choosing a freshness threshold is also a product policy; showing age requires no threshold decision. The project-session label avoids inventing development classification, so no execution-authority decision is needed for the read-only catalog.

## Source pins

All rows matched frozen and current owner source on read at the recorded time. These pins are provenance for this plan, not a freeze of the active owner's other files.

```json
{
  "readAtUTC": "2026-10-06T02:12:43.730216+00:00",
  "sources": [
    {
      "path": "apps/api_server/src/services/coordinator_conversation_context.ts",
      "frozenSHA256": "be26a22e2f328bbe2958d41768fa96e7ddcf8250cc08e9420d8bbbdeb2116000",
      "ownerReadSHA256": "be26a22e2f328bbe2958d41768fa96e7ddcf8250cc08e9420d8bbbdeb2116000",
      "same": true
    },
    {
      "path": "apps/api_server/src/services/coordinator_conversation_runtime_adapters.ts",
      "frozenSHA256": "aa3b5f0b800c3e5825801b344f780f326eae63e2213612c6223566fb9e10aea0",
      "ownerReadSHA256": "aa3b5f0b800c3e5825801b344f780f326eae63e2213612c6223566fb9e10aea0",
      "same": true
    },
    {
      "path": "apps/api_server/src/contracts/coordinator_conversation_contract.ts",
      "frozenSHA256": "09fa66d4de0ddb4d9a6e09d8705ce8b19ad34aa94e4288c0261bdfd3ce8d0922",
      "ownerReadSHA256": "09fa66d4de0ddb4d9a6e09d8705ce8b19ad34aa94e4288c0261bdfd3ce8d0922",
      "same": true
    },
    {
      "path": "apps/api_server/src/repositories/calendar_shadow_events_repository.ts",
      "frozenSHA256": "a0b3c8148d1ef641d95b85177a60900131b2b179a4d575bd59ea1f4f7d45e0cb",
      "ownerReadSHA256": "a0b3c8148d1ef641d95b85177a60900131b2b179a4d575bd59ea1f4f7d45e0cb",
      "same": true
    },
    {
      "path": "apps/api_server/src/repositories/integration_accounts_repository.ts",
      "frozenSHA256": "dedc5820ce0c365e96827521ab0d87bb54a0596970b16dacc7bb0c5eea5ddb35",
      "ownerReadSHA256": "dedc5820ce0c365e96827521ab0d87bb54a0596970b16dacc7bb0c5eea5ddb35",
      "same": true
    },
    {
      "path": "apps/api_server/src/repositories/integration_preferences_repository.ts",
      "frozenSHA256": "ccdf5fd00368a230539428622e9274c9ff803e91720476692c3f1abfe7775fc0",
      "ownerReadSHA256": "ccdf5fd00368a230539428622e9274c9ff803e91720476692c3f1abfe7775fc0",
      "same": true
    },
    {
      "path": "apps/api_server/src/services/integrations_service.ts",
      "frozenSHA256": "da5d41077a71342ce182a47f7f2fa2844693e99d7bd4d2abe06ed8073b861e67",
      "ownerReadSHA256": "da5d41077a71342ce182a47f7f2fa2844693e99d7bd4d2abe06ed8073b861e67",
      "same": true
    },
    {
      "path": "apps/api_server/src/integrations/google_calendar/google_calendar_service.ts",
      "frozenSHA256": "ad5612568f191ce9dae272fddc89443c627a7ec0ff90e330d7429da4a2c1c73f",
      "ownerReadSHA256": "ad5612568f191ce9dae272fddc89443c627a7ec0ff90e330d7429da4a2c1c73f",
      "same": true
    },
    {
      "path": "apps/api_server/src/repositories/agent_sessions_repository.ts",
      "frozenSHA256": "003284312a23745206400c75cb28e0abc76e42a13f984875156e698e84cbd233",
      "ownerReadSHA256": "003284312a23745206400c75cb28e0abc76e42a13f984875156e698e84cbd233",
      "same": true
    },
    {
      "path": "apps/api_server/src/repositories/projects_repository.ts",
      "frozenSHA256": "518faf73f4ebeef424ea2e26118f3fc39baf4bae1787af721ea62f11860ca3d3",
      "ownerReadSHA256": "518faf73f4ebeef424ea2e26118f3fc39baf4bae1787af721ea62f11860ca3d3",
      "same": true
    }
  ]
}
```
