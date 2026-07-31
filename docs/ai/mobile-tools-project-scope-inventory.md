---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-006-project-scoped-tools
tags: [mobile, tools, project-scope, parity]
---

# Mobile Tools project-scope inventory

All paired rows use the active opaque project ID in
`X-Rhythm-Project-ID`. The mobile client fails closed before transport when no
project is selected. The `/mobile-gateway/tools/*` routes currently enforce the
ownership policy shown below and ignore filesystem roots; the
`/mobile-gateway/opencode/*` proxy additionally requires and resolves the
project header through `requireMobileProjectScope()`.

Response envelopes and maps are normalized by
`RhythmToolsService.loadScreen()` / `normalizeToolScreenResponse()` before the
provider or screen receives records.

| Screen | Mobile endpoint | Desktop path | Response shape | Ownership filter | State handling |
|---|---|---|---|---|---|
| Brain | `GET /mobile-gateway/tools/agent-memory` | `GET /agent-memory` | Array or `{items}` → memory rows keyed by `id` | Paired device + verified workspace/global admin (`mac-global-admin`) | Empty only after successful `[]`; otherwise the paired scope/pairing/version/network classifier |
| Research | `GET /mobile-gateway/tools/agent-research` | `GET /agent-research` | Array or `{items}` / `{data}` → research rows keyed by `id` | Paired device user; repository/controller owner filter (`owner-scoped`) | Shared paired classifier; network cache is read-only |
| Scheduled Jobs | `GET /mobile-gateway/tools/agent-schedules` | `GET /agent-schedules` | Array or envelope → schedule rows keyed by `id` | Paired device user; owner-scoped | Shared paired classifier; network cache is read-only |
| Webhooks | `GET /mobile-gateway/tools/agent-webhooks` | `GET /agent-webhooks` | Array or envelope → webhook rows; returned secrets are one-time and excluded from state cache | Paired device user; owner-scoped | Shared paired classifier; secrets never participate in empty/cache state |
| Profiles | `GET /mobile-gateway/tools/agent-configs` | `GET /agent-configs` | Array or envelope → profile rows keyed by `id` | Paired device + verified workspace/global admin (`mac-global-admin`) | Shared paired classifier; stale project and policy denial remain explicit |
| Cookbook | `GET /mobile-gateway/tools/agent-cookbook` | `GET /agent-cookbook` | Array or envelope → recipe rows keyed by `id` | Paired device user; owner-scoped | Shared paired classifier; network cache is read-only |
| Review Queue | `GET /mobile-gateway/tools/agent-org-proposals?status=pending` | `GET /agent-org-proposals?status=pending` | Array or envelope → proposal rows keyed by `id` | Paired device + verified workspace/global admin (`mac-global-admin`) | Shared paired classifier; unauthorized/admin denial is never empty |
| Report Card | `GET /mobile-gateway/tools/agents/run-quality?windowDays=30` | `GET /agents/run-quality?windowDays=30` | `{windowDays, agents:[...]}` → `agents` rows keyed by `agentKind` | Paired device user; owner-scoped rollup | Shared paired classifier; successful zero-agent rollup is empty |
| Email | `GET /integrations/gmail-signals?limit=20` through Rhythm Cloud | Same production API path | Array or envelope → signal rows keyed by `externalId` | Rhythm Cloud bearer user; integration access is user-owned | Cloud expired-auth is distinct; cloud network cache is read-only and project-independent |
| Gallery | `GET /agent-designs` through Rhythm Cloud | Desktop currently reads local `GET /agent-designs` | Array or envelope → design rows keyed by `id` | Rhythm Cloud bearer user on mobile; desktop local-agent auth posture differs | Cloud expired-auth is distinct; no paired-project fallback |
| Skills | `GET /mobile-gateway/tools/opencode/skills?withMetadata=true` | `GET /opencode/skills?withMetadata=true` | Array or envelope → skill rows keyed by `name` | Paired device + verified workspace/global admin (`mac-global-admin`) | Shared paired classifier; network cache contains approved metadata only |
| Playbooks | `GET /mobile-gateway/tools/opencode/commands` | `GET /opencode/commands` | Array or envelope → command rows keyed by `name` | Paired device + verified workspace/global admin (`mac-global-admin`) | Shared paired classifier; network cache contains approved metadata only |
| MCP | `GET /mobile-gateway/opencode/mcp` | Desktop local API `GET /opencode/mcp` | Engine status map or desktop enriched array → MCP rows keyed by server name | Paired device + `requireMobileProjectScope`; project root injected server-side | Missing/stale project, unauthorized pairing, version mismatch, policy denial, and network failure remain distinct |
| Providers & Models | `GET /mobile-gateway/opencode/provider`, `/provider/auth`, and `/config` | Desktop provider/model catalog ultimately derives from the same local engine (`GET /agents/models/catalog` plus auth routes) | Provider array or `{all, connected, default}` + auth map + config → provider rows; auth metadata recursively redacted | Paired device + `requireMobileProjectScope`; project-scoped engine config | Three requests share one project signal; any failure classifies the whole screen without a false empty |

## State classification

| State | Detection | Items shown | User action |
|---|---|---|---|
| Actual empty | Successful normalized response is `[]` | Empty state | Create/wait for data |
| Missing scope | No active project before request, or explicit project-scope 400 | None | Select a project |
| Stale project | Scoped gateway returns 404 for an archived, removed, or unusable registered root | None | Select another registered project |
| Unauthorized pairing | Pairing state is unpaired/revoked/account-mismatched, or paired request returns 401 | None | Pair again or use the matching Rhythm account |
| Version mismatch | Paired-host compatibility probe reports `incompatible` | None | Update the Mac and iPhone clients |
| Network failure | Offline/Tailscale/unhealthy pairing state, status `0`, or retryable transport failure | Secret-free cached rows when available; otherwise an explicit network state | Restore network/Tailscale and retry |

`403` remains a separate policy-denied state, and Rhythm Cloud `401` remains
`expired-auth`; neither is treated as empty.

## Live parity test (written, not run in MSP-006)

Run only against an already-started isolated test backend and throwaway paired
device credential. Do not use production credentials or an installed database.
The command intentionally keeps all secret values in environment variables:

```bash
cd apps/mobile
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_MOBILE_GATEWAY_URL=http://127.0.0.1:<isolated-mobile-gateway-port> \
RHYTHM_LIVE_MOBILE_DEVICE_TOKEN="$RHYTHM_THROWAWAY_DEVICE_TOKEN" \
RHYTHM_LIVE_PROJECT_ID="$RHYTHM_THROWAWAY_PROJECT_ID" \
RHYTHM_LIVE_DESKTOP_API_URL=http://127.0.0.1:<isolated-desktop-api-port> \
RHYTHM_LIVE_DESKTOP_AUTHORIZATION="$RHYTHM_THROWAWAY_DESKTOP_AUTHORIZATION" \
node --test tests/msp-006-live-parity.test.mjs
```

MSP-006 did not execute this command because its safety contract explicitly
forbids starting the API server, engine, sandbox helper, or ports 4096–4098.
