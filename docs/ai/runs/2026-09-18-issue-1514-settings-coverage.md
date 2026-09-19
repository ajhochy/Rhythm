---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1514-agent-settings
pr: null
issues: [1514]
status: implemented-awaiting-rendered-verification
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
| Accounts | Desktop local | Agent settings → Accounts | Reads actual authorized account labels/status through `sessions.ts`. Starting authorization and entering credentials remain an explicit gap; use Flutter Agent settings → Accounts so credentials never enter renderer state. |
| Behavior → Require modal for destructive tools | Desktop local | Agent settings → Behavior | Explicit gap. The desktop gateway has no persisted behavior preference, so the inspector shows no temporary or no-op switch. Configure in Flutter Agent settings → Behavior. |
| Keybindings: send, new session, cancel turn, switch session, reset defaults | Desktop local | Agent settings → Keybindings | Explicit gap. The desktop gateway has no shortcut persistence path. Configure in Flutter Agent settings → Keybindings. |
| OpenCode server URL and reset to embedded | Desktop local | Agent settings → Runtime / OpenCode server | Shows trusted host API/engine ports and supports health checks. URL mutation and restart remain an explicit gap; configure in Flutter Agent settings → OpenCode server. |
| MCP list and live status | Workspace | Agent settings → MCP servers | Reads actual servers through `mcp.ts`, including source, status, tool count, credential requirement, and bounded server error. |
| MCP connect/disconnect/remove | Workspace | Agent settings → MCP servers | Uses existing `mcp.ts` actions. Remove keeps an explicit confirmation. Row selection never invokes these mutations. |
| MCP add, credential entry, and OAuth browser completion | Workspace | Agent settings → MCP servers | Explicit gap. Configure in Flutter Agent settings → MCP servers; the Electron renderer stores no credential values and does not navigate itself to provider authorization URLs. |
| Desktop endpoint and offline-buffer fixture actions | Desktop local | Agent settings → Runtime / OpenCode server | Existing deterministic fixture actions remain reachable from the inspector for rendered tests. They make no network request. |
| General workspace settings and Dashboard artifact-tab preference | Workspace and user | Main Settings / Dashboard | Remain owned by `settings.ts` and `user-preferences.ts`; they are outside Agent Settings and are not presented as agent controls. |

## Files

- `apps/web/src/components/tools/AgentSettingsTool.tsx` — extracted Agent Settings and added the section list, live values, supported actions, and explicit gaps.
- `apps/web/src/components/tools/AgentSettingsTool.css` — co-located layout and responsive styling.
- `apps/web/src/components/ToolWorkspace.tsx` — imports the extracted fixture/live Agent Settings tools.
- `apps/web/tests/pages/agent-settings-list-inspector.spec.ts` — shared primitive interaction, state, accessibility, responsive, and deep-link coverage.
- `apps/web/tests/bucket-a-rendered-repair.spec.ts` — updated old markup assertions and added live account/MCP action coverage.
- `apps/web/tests/secondary-tool-paths.spec.ts` — reaches retained fixture actions through the inspector.

## Checks

- `cd apps/web && npm run typecheck` — pass.
- `cd apps/web && npm run build` — pass; Vite transformed 1,684 modules and produced the production bundle.
- `cd apps/web && npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --skipLibCheck --types node tests/pages/agent-settings-list-inspector.spec.ts tests/secondary-tool-paths.spec.ts tests/bucket-a-rendered-repair.spec.ts` — pass.
- `git diff --check` — pass.
- `gitnexus impact LiveSettingsTool|AutoPromotionSettings|SettingsTool|ToolWorkspace --repo Rhythm --direction upstream --include-tests` — pass before edits; all four reported LOW risk and one direct caller.
- `gitnexus detect-changes --repo /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-1514-agent-settings --scope compare --base-ref main --limit 100` — unavailable; this worktree is not registered and the two registered Rhythm indexes are ambiguous/stale.
- Browser-rendered Playwright checks were written but not run in this worker because the brief prohibits binding sockets.

## Notes

- No credential input was added to the renderer.
- No selection handler executes, mutates, syncs, starts OAuth, or changes auto-promotion.
- Loading and request failures keep the last responsible gateway boundary visible; unsupported controls render a named configuration destination.
