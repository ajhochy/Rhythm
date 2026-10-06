---
date: 2026-10-06
repo: Rhythm
branch: codex/chat-only-bounded-workflow
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

# Dayflow panel chrome

User request: "get rid of the header and footer on dayflow tab. they are not needed."

## Files

- `apps/web/src/components/tools/DayflowTool.tsx`: remove outer header, Settings button, explanatory footer, and the unused navigation import; preserve native attach/lifecycle/bounds/modal/error behavior.
- `apps/web/src/components/ToolWorkspace.css`: give Dayflow one remaining-height grid row and a shrinking/growing native host; remove unused Dayflow footer rule. Existing body padding remains.

## Checks

Durable checklist used because TodoWrite is unavailable:

- [x] Read AGENTS, coding-agent skill, project state, relevant current plan, and exact direct request before source inspection.
- [x] Confirm scope ownership and preserve unrelated dirty files; no dependency install, API start, GUI, commit, push, or packaging.
- [x] Upstream GitNexus impact for `DayflowTool`: LOW, one direct caller (`ToolWorkspace`), three total affected symbols through `App` / `renderGateway`, two modules, zero flows; root reported before edits.
- [x] Browser contract changed by root first; genuine RED exit 1, expected zero outer chrome nodes, received two. Receipt: `/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-chrome-red.txt`.
- [x] Make the smallest change in the two assigned source files; preserve bridge implementation and native controls.
- [x] Focused Dayflow browser suite plus Sol negatives: 16/16 passed, exit 0.
- [x] Web typecheck: exit 0.
- [x] Review final owned diff and write actual check results before handoff; `git diff --check` exit 0.

Exact focused command, run from `apps/web`:

```sh
env PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin DAYFLOW_VIEW_PORT=48440 npx --no-install playwright test --config /Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow/contract-ui-env/dayflow-view-chromium-1223.config.ts --workers=1 > /Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-chrome-green.txt 2>&1
```

Observed output: `16 passed (6.0s)`. The first contract proves no outer header/footer/Settings button/copy and host content-height equality without body overflow at viewport heights 300, 480, 560, and 900. At width 1280 the host/native rectangle was `(22, 16, 1236, 516)` for viewport height 560 and `(22, 16, 1236, 856)` for height 900. Existing attach order, modal/visibility occlusion, malformed/denied status, unmount, stale results, and late-promise controls passed unchanged.

Exact typecheck command, run sequentially after browser checks from `apps/web`:

```sh
env PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run typecheck > /Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-chrome-typecheck.txt 2>&1
```

Observed output: `tsc -b`, exit 0. No dependency installation occurred. Full PR gate and signed installed/native check: NOT RUN in this worker; root owns those checks.

## Notes

- Current plan's earlier Settings/footer reachability requirement is superseded by this direct user request. Root reports C7 qualification green; this next candidate (C8) still awaits full-gate and signed installed/native verification.
- No backend change; no sandbox/API/fork test is required for this panel chrome change. Browser facade proof does not establish installed native rendering or scrolling.
- Deviations from request: none. Full verification and exact-source packaging remain root-owned; this implementation handoff is unverified until those gates run.
