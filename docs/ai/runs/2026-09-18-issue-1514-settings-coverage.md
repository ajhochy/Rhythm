---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1514-agent-settings
pr: null
issues: [1514]
status: implemented-awaiting-verification
tags: [run, Rhythm]
---

# Issue 1514 settings coverage

## Configuration coverage matrix

| Flutter or agent-menu entry | Scope | Electron destination | Coverage and owning service |
| --- | --- | --- | --- |
| Agent menu → Agent settings | Desktop local and workspace | Agents → Agent settings | Seven-section shared list and inspector; selection only changes the inspector. |
| Agent menu → Agent profiles | Agent / profile | Profiles overview → Open profile editor (`#/profiles`) | Existing Profiles surface remains the editor. Detailed per-profile layout work belongs to #1523. |
| Profiles manager: list, search, sort, create, rename, duplicate, delete | Agent / profile | `#/profiles` | Existing live profile gateway through `sessions.ts`; no controls are duplicated in the overview. |
| Default profile | Agent / profile | `#/profiles` | Existing surface shows the default. Its live page currently states that the selection resets on reload; #1523 owns this per-profile/editor limitation. |
| Profile identity, availability, provider/model/account, delegation, skills, MCP scope, and core permissions | Agent / profile | `#/profiles` | Existing profile editor and `sessions.ts` mutations. Protected-action policy remains profile-owned and is not weakened by Agent Settings. |
| Auto-promotion | Workspace | Agent settings → Auto-promotion | Existing `autoPromotion` gateway, eligibility checks, regression gate, explicit confirmation dialog, pending state, and server failure text are preserved. |
| Accounts | Desktop local | Agent settings → Accounts | Reads authorized Anthropic accounts and default selection through `sessions.ts`. Authorization start/completion, default selection, and removal use the existing `/opencode/auth/accounts/*` routes. Pending, failure, and persisted reload states are visible. |
| Behavior → Require modal for destructive tools | Desktop local | Agent settings → Behavior | Explicit gap. Flutter persists this through `DestructiveModalService`; no HTTP service owns it. The Electron notice names the required GET/PATCH `/agent-settings/behavior` path and shows no no-op switch. |
| Keybindings: send, new session, cancel turn, switch session, reset defaults | Desktop local | Agent settings → Keybindings | Explicit gap. Flutter persists this through `KeybindsService`; no HTTP service owns it. The Electron notice names the required GET/PATCH `/agent-settings/keybindings` path and shows no temporary editor. |
| OpenCode server URL and reset to embedded | Desktop local | Agent settings → Runtime / OpenCode server | Shows trusted host API/engine ports and supports existing health checks. Mutation/restart remains an explicit gap because Flutter uses `OpencodeServerService`; the notice names required GET/PATCH `/opencode/runtime` and POST `/opencode/runtime/restart` paths. |
| MCP list and live status | Workspace | Agent settings → MCP servers | Reads actual servers through `mcp.ts`, including source, status, tool count, credential requirement, and bounded server error. |
| MCP connect/disconnect/remove | Workspace | Agent settings → MCP servers | Uses existing `mcp.ts` actions. Remove keeps an explicit confirmation. Row selection never invokes these mutations. |
| MCP add, credential entry, and OAuth browser completion | Workspace | Agent settings → MCP servers | Uses existing `mcp.ts` add, credentials, OAuth start/status, and list routes. Secret fields use password inputs and are cleared after the service accepts them; authorization links require an explicit click. Saved server state is reloaded from the service. |
| Desktop endpoint and offline-buffer fixture actions | Desktop local | Agent settings → Runtime / OpenCode server | Existing deterministic fixture actions remain reachable from the inspector for rendered tests. They make no network request. |
| General workspace settings and Dashboard artifact-tab preference | Workspace and user | Main Settings / Dashboard | Remain owned by `settings.ts` and `user-preferences.ts`; they are outside Agent Settings and are not presented as agent controls. |

## Files

- `apps/web/src/components/tools/AgentSettingsTool.tsx` — section list, live values, account and MCP service actions, pending/error states, and explicit endpoint gaps.
- `apps/web/src/components/tools/AgentSettingsTool.css` — co-located layout and responsive styling.
- `apps/web/src/gateway/sessions.ts` — existing account service routes exposed through the web gateway.
- `apps/web/src/components/ToolWorkspace.tsx` — imports the extracted fixture/live Agent Settings tools.
- `apps/web/tests/pages/agent-settings-list-inspector.spec.ts` — shared primitive coverage plus stateful account and MCP edit, save, and reload specs.
- `apps/web/tests/bucket-a-rendered-repair.spec.ts` — updated old markup assertions and added live account/MCP action coverage.
- `apps/web/tests/secondary-tool-paths.spec.ts` — reaches retained fixture actions through the inspector.

## Checks

- Verification for the combined #1524/#1514 repair is recorded in `REPORT.md`.
- Browser-rendered Playwright checks were written but not run because this worker is prohibited from binding sockets.

## Notes

- Account OAuth codes and MCP secret values are held only in form state, sent to the responsible service on explicit submit, and cleared after a successful save.
- No selection handler executes, mutates, syncs, starts OAuth, or changes auto-promotion.
- Loading and request failures keep the last responsible gateway boundary visible; unsupported controls render a named configuration destination.
