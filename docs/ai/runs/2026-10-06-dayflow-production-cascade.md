---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: 1604
issues: [1605]
status: pass
tags: [run, rhythm, dayflow]
index: "[[Rhythm]]"
---

# Dayflow production CSS cascade

Same user request: remove Dayflow's outer header/footer while the native workspace fills the available panel height.

## Files

- `apps/web/src/components/ToolWorkspace.css`: change only the one-row selector from `.dayflow-workspace` to `.tool-workspace.dayflow-workspace`, so it wins over the shared `.tool-workspace` grid rule regardless of stylesheet order. No JS, native, API, or other CSS edits by this worker.
- Root separately owns `apps/web/tests/dayflow-view-harness.tsx`: import component CSS before global CSS, matching the shipping entry's order; all existing test assertions are preserved.

## Checks

Durable checklist used because TodoWrite is unavailable:

- [x] Read AGENTS, coding-agent skill, project state/relevant current plan, exact direct request, and likely files.
- [x] Honor root's edit hold until the real production-order browser RED completed.
- [x] Scope/impact: manual LOW, Dayflow-only CSS selector; no indexed function/class/method is modified.
- [x] Apply only the higher-specificity selector; preserve unrelated source, native controls, lifecycle, body padding, and behavioral contracts.
- [x] Focused unchanged 16 browser tests, production import order: 16/16 passed, exit 0 (`6.9s`).
- [x] Web typecheck, sequentially after browser checks: `tsc -b`, exit 0.
- [x] Final owned diff/whitespace review and actual results before root handoff: one selector only; `git diff --check` exit 0.

Root's production-order RED: exit 1, expected `true`, received `false` waiting for `blocked:false`; the host never reported usable positive geometry. Raw receipt: `/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-production-cascade-red.txt`. Root preserved failure screenshot/context/trace before GREEN could replace Playwright's configured results: `dayflow-cascade-red-artifacts/` in that same external folder.

Exact RED command (root-owned, before this selector edit), cwd `/Users/ajhochhalter/.codex/worktrees/chat-bounded-workflow/Rhythm/apps/web`:

```sh
PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin DAYFLOW_VIEW_PORT=48440 npx --no-install playwright test --config /Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow/contract-ui-env/dayflow-view-chromium-1223.config.ts --workers=1 --grep 'native Dayflow has no outer' > /Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-production-cascade-red.txt 2>&1
```

Exact GREEN command, same cwd:

```sh
env PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin DAYFLOW_VIEW_PORT=48440 npx --no-install playwright test --config /Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow/contract-ui-env/dayflow-view-chromium-1223.config.ts --workers=1 > /Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-production-cascade-green.txt 2>&1
```

Observed `16 passed (6.9s)`. The unchanged first contract asserts no outer chrome and positive, content-height-filling geometry at viewport heights 300, 480, 560, and 900. At width 1280 the host/native rectangles both measured `(22, 16, 1236, 516)` for height 560 and `(22, 16, 1236, 856)` for height 900. Attach order, modal/visibility occlusion, malformed/denied states, unmount, stale responses, and late promises passed unchanged.

Exact typecheck command, run only after the browser suite finished, same cwd:

```sh
env PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run typecheck > /Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/dayflow-production-cascade-typecheck.txt 2>&1
```

Observed `tsc -b`, exit 0. No dependency installation or API startup occurred. Browser harness uses the synthetic bridge and proves web geometry/control behavior; it does not prove native pixels.

## Notes

- Root's settled normal-profile C8 signed-app CUA check at 1280×800 showed blank Dayflow, with no outer header/footer or failure text: installed behavior FAIL. The web entry imports component CSS before global styles. Equal-specificity `.dayflow-workspace` lost to the later shared three-row grid, leaving the only body in the auto row and its flex host at zero height. The old browser harness imported these styles in the opposite order and masked the defect. A native-wrapper failure is not established by this symptom.
- C8 browser/full-gate/package successes did not qualify the repaired source. Exact C9 gates and signed native CUA now close that qualification gap; the historical C8 blank-app failure remains in `runs/2026-10-06-issue-1605-c8-cascade-postmortem.json` unchanged.
- Selector specificity makes the scoped one-row layout independent of CSS source order. C9 issue 4/4, PR 22/22, chat browser 1/1, Dayflow/Sol 16/16, and native AppKit C1–C3 passed. Actual signed normal-profile CUA at normal/short/tall sizes passed; the 3440×1300 target yielded 3440×1296 after macOS zoom. Short-window native scrolling reached Copy timeline, Settings, and Review cards and restored the top. Geometry figures are approximate screenshot estimates, not direct NSRect measurements; physical-human proof remains unrun.
- C9 package/sign/stable-copy/strict-verifier/signed-smoke/launch checks passed. The app is signed and not notarized. Root preserves C8 failure and writes the separate C9 PASS postmortem. Provider semantics, human-native P256 fixture, physical phone, native 16-screen matrix, final-doc CI, and owned cleanup remain unrun/pending.
