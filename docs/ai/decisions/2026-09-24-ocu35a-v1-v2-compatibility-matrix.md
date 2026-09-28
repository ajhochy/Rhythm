---
date: 2026-09-24
status: blocked
tags: [decision, rhythm, issue-1176, opencode-v2]
---

# OCU-35A v1/v2 session compatibility matrix

## Audit stamp

Audited vendored OpenCode fork version: **1.14.49**
(`apps/opencode_fork/packages/opencode/package.json:3`). No v2 adoption trigger
is met. V1 remains authoritative and no rollout flag or v2 bridge is added.

`placeholder` means a route/type exists but its implementation is an unsafe
cast or empty body. `absent` means there is no equivalent operation on the v2
service/API, so naming a nearby read or subagent operation is not parity.

## Operation matrix

| Rhythm v1 operation | Current v1 call site | v2 equivalent | v2 status and evidence |
|---|---|---|---|
| Session create | `apps/api_server/src/services/opencode_client_service.ts:1139-1290` (`client.session.create` at 1275) | `SessionV2.create` | **placeholder** — `apps/opencode_fork/packages/opencode/src/v2/session.ts:168-171` returns `{} as any`; no create endpoint appears in `.../groups/v2/session.ts:33-109`. |
| `prompt_async` | `opencode_client_service.ts:1720-1760` (`client.session.promptAsync` at 1758) | `SessionV2.prompt` with `delivery: deferred` | **placeholder** — v2 implementation returns `{} as any` at `v2/session.ts:289-291`; the HTTP route is only a facade at `groups/v2/session.ts:54-70`. |
| Abort/cancel | `opencode_client_service.ts:2043-2055` (`client.session.abort`) | none | **absent** — no abort member in `v2/session.ts:68-121` and no abort endpoint in `groups/v2/session.ts:33-109`. |
| Shell | `opencode_client_service.ts:2673-2697` (`POST /session/:id/shell`) | `SessionV2.shell` | **placeholder** — empty body at `v2/session.ts:292`. No v2 shell endpoint exists. |
| Summarize/compact | `opencode_client_service.ts:2912-2939` (`client.session.summarize`) | `SessionV2.compact` | **placeholder** — empty body at `v2/session.ts:329`; the facade returns 204 via `groups/v2/session.ts:71-83`. |
| Permission reply | `opencode_client_service.ts:2189-2208` (`POST /permission/:id/reply`) | none | **absent** — v2 registers only Session/Message/Model/Provider groups (`.../groups/v2.ts:7-11`), with no permission group. |
| Question reply | `opencode_client_service.ts:2269-2287` (`client.question.reply`) | none | **absent** — no question member or v2 group (`groups/v2.ts:7-11`). |
| Revert | `opencode_client_service.ts:2865-2885` (`client.session.revert`) | none | **absent** — no revert member in `v2/session.ts:68-121` or v2 route. |
| Unrevert | `opencode_client_service.ts:2890-2907` (`client.session.unrevert`) | none | **absent** — no unrevert member or route. |
| Fork | `opencode_client_service.ts:2944-2963` (`client.session.fork`) | none | **absent** — `SessionV2.subagent` is not transcript fork parity and composes placeholder create/prompt/wait (`v2/session.ts:308-328`). |
| Messages paging | `opencode_client_service.ts:2747-2769` (`client.session.messages`) | `SessionV2.messages` | **real read path** — cursor/order query and decode at `v2/session.ts:216-255`; this does not prove write/lifecycle parity. |
| Session status map | `opencode_client_service.ts:2378-2403` (`GET /session/status`) | none | **absent** — v2 has `get/list` reads but no authoritative busy/idle status-map operation or endpoint. |
| Global SSE subscribe/reconnect | `apps/api_server/src/services/opencode_stream_bridge.ts:717-848` subscribes to `/global/event`; watchdog reconnect is `:859-939`; fan-out contract is `opencode_event_hub.ts:91-139` | proposed `session.next.*` event stream | **absent** — v2 API registers no event group (`groups/v2.ts:7-11`), so cursor/resume/reconnect semantics do not exist. |

## Event and failure semantics still required

The current bridge consumes tool parts (`opencode_stream_bridge.ts:1391-1488`),
session status/errors (`:1661-1722`, `:2075-2142`), and permission events
(`:2190-2235`), while its question recovery path is documented at `:576-639`.
V2 has no demonstrated equivalents for permission/question recovery, retries,
tool-part ordering, cancellation, terminal errors, or reconnect/resume. Its
prompt, shell, compact, and wait error channels are typed `never`
(`v2/session.ts:102-120`), which cannot yet preserve observable failure
behavior.

## Decision

Keep #1176 blocked. Re-run the audit and update this matrix when the tripwire in
`apps/api_server/src/__tests__/ocu35a_v2_adoption_tripwire.test.ts` fails after a
vendored subtree rebase. Adoption additionally requires generated SDK types,
dual-bridge behavioral parity, rollback readability, and the exact upstream
trigger commit; this document alone does not unblock any migration.
