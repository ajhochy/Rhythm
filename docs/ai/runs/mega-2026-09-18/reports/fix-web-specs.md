# Summary

- Repaired the six targeted rendered-spec failures by scoping assertions to the ListInspector detail, selecting the Settings Appearance row before reset, using the actual Email row test ID, and targeting the Chapel checkbox by role.
- Removed live-mode fixture leakage from Agent Tools: Webhooks now renders an explicit `Not available for live sessions yet` state, and Email now loads real Gmail signals, creates a scoped Email Assistant session, sends the selected signal as labeled untrusted external context, and deep-links to that session.
- Added rendered live-mode coverage proving Webhooks shows no demo record and Email uses the Gmail/session gateways and sends the selected signal over `session.input`.
- Verification ran on `mega/fix-web-specs` at `a854189186b16cdec61654ff74d9fdad1fc32ac8`.

# Files changed

- `apps/web/src/components/ToolWorkspace.tsx` — live Webhooks unavailable state and live Email list, inspector, refresh, scoped session launch, context delivery, and deep link.
- `apps/web/tests/tools.spec.ts` — ListInspector-aware detail assertions and corrected Email row selector.
- `apps/web/tests/splitter.spec.ts` — selects Appearance before invoking Reset layout.
- `apps/web/tests/electron-e15-facilities-safety.spec.ts` — unambiguously selects the Chapel checkbox instead of the room option.
- `apps/web/tests/bucket-a-rendered-repair.spec.ts` — rendered live Webhooks and Email gateway/session/WebSocket contract.
- `REPORT.md` — this handoff report.

# Checks run

- `cd apps/web && npm run typecheck` — PASS, exit 0.
- `cd apps/web && npm run build` — PASS, exit 0; Vite emitted only its existing chunk-size warning.
- `cd apps/web && node_modules/.bin/tsc --noEmit --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 --jsx react-jsx --types node,@playwright/test tests/tools.spec.ts tests/splitter.spec.ts tests/electron-e15-facilities-safety.spec.ts tests/bucket-a-rendered-repair.spec.ts` — PASS, exit 0 with no diagnostics.
- `git diff --check` — PASS, no whitespace errors.
- `gitnexus detect-changes --scope unstaged --repo /Users/ajhochhalter/Documents/Rhythm --limit 200` — PASS, LOW risk, 0 affected processes. The stale index mapped the component hunk imprecisely to nearby symbols.
- Playwright was not run because this worktree is prohibited from binding sockets; the orchestrator owns the rendered rerun.

# Decisions

- Kept fixture Webhooks and Email behavior intact; only live routing changed.
- Used the existing `integrations.gmailSignals`, session creation, and WebSocket gateways. The shared `SessionGateway` interface was not changed because GitNexus reported CRITICAL upstream reach; the existing create implementation already forwards the structurally compatible `mcpRole` and `taskTitle` fields.
- Used canonical `profileId: secretary` with `mcpRole: email-assistant`, `/workspace/rhythm` when no current live cwd exists, and `#/agents?sessionId=<id>` after creation.
- Labeled Gmail sender, subject, and preview as untrusted external data before sending them to the session.
- Left the shared Splitter reset implementation unchanged because it already removes every `layout.*` key and broadcasts the mounted reset event; only the migrated Settings navigation step was stale.
- Left Facilities production code unchanged because the multi-room checkbox is still present; the broad label locator collided with the new room option.

# Follow-ups

- Orchestrator: rerun the six targeted Playwright tests plus `bucket-a-rendered-repair.spec.ts` under its dedicated config.
- A real Webhooks gateway remains future work; live mode now states that limitation instead of showing demo records.
- No commit, stash, checkout, server start, or socket bind was performed.
