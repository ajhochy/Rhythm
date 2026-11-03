---
date: 2026-10-05
repo: Rhythm
branch: source-archive-no-git-metadata
pr: null
issues: []
status: verified
tags: [run, rhythm, web, notifications]
---

# Notification presentation correction

Baseline: committed source archive exported from `d10d689090f76d49de7b0f937cebf0706b645457`. Verification applies to this isolated renderer patch. Builder owns packaged build, installation, and live runtime verification.

## Problem and final behavior

The supplied screenshot displayed raw `task.create` JSON in approval cards. The generic stacked-menu child rule also overrode the old flex action row, stacking large buttons. Known exact task.create approvals now show a readable title, due date and bounded notes. Full consequences remain visible, and Show details exposes the exact complete original payload as literal text.

The user reviewed the first preview and requested tighter controls. Approve/Reject now use 28px green/gray icon buttons beside the title, with accessible names, tooltips, keyboard focus and unchanged decision handlers. The heading wraps at very narrow widths. The old footer action row and its large mobile sizing are removed.

## Files

- `apps/web/src/components/Shell.tsx`: exact action/payload presentation and local details disclosure; compact title controls; original callback and busy/unsigned conditions retained.
- `apps/web/src/styles.css`: scoped wrapping/overflow rules, two-line title and three-line summary, 12px body and 11px consequence/details text, compact action targets and focus states.
- `apps/web/tests/notification-presentation.spec.ts` and its config: 20 rendered checks; existing E1 approval suite adds 9 regression checks. All traffic is synthetic and intercepted before navigation. Presentation cases use the actual CSP; E1 retains its existing alternate-port fixture CSP behavior.
- `docs/ai/contracts/task-notification-presentation.json`: all 20 current acceptance criteria passed.

## Current compact-revision evidence

- `cd apps/web && RHYTHM_CAPTURE_EVIDENCE=1 npx playwright test --config tests/notification-presentation-playwright.config.ts`: exit 0, **29 passed (2.0m)**, single worker and one bounded run. Includes inline control geometry, 240px wrapping, 320/390/1024/1392px menu bounds, exact details/fallbacks, signed ID/nonce/digest with keyboard activation, existing error retention, unsigned approvals, long titles, missing notes, and positive native reservations/unchanged attachments at 520/1392px for Hermes and Bot Crossing.
- Actual desktop and 390px rendered pixels inspected. The existing Library preview `libfile_979aafb6a7188191919cedbc673aeecf` was replaced with **version 1** for review before builder integration.
- Same persisted Sol CLI session completed read-only source review: no material source findings; accessible names/focus, wrapping, details and unchanged decision semantics confirmed.
- Source-only and full patch application checks against an exact baseline fixture: exit 0. Gateway, signer, store and native host/bridge source hashes match baseline.

## Historical evidence and limits

- Before the initial correction, title and vertical-button checks failed; review also reproduced excessive long-title height, a missing collapsed details target, and raw JSON for a task without notes. Those cases are covered by the current passing checks.
- The earlier footer-button revision passed web typecheck/build and dist-smoke. Those checks are historical; the current compact revision intentionally used the authorized bounded UI pass without another broad build. Builder compilation and installed-runtime checks remain pending.
- User explicitly requested focused presentation verification. No live API/engine activity, live desktop driving or native process modification was performed by this worker.
- Implementation resumed the same normal-home Terra5.6 CLI session; review resumed the same Sol session. No ephemeral modes, duplicated producers or sandbox/hook bypass flags were used. Previously paused owned processes were confirmed exited before the bounded revision.

## Preserved behavior

Only exact `Authorize task.create` plus a valid `task.create: ` object gets field presentation. Original strings are retained without invented summaries. Unknown/malformed/mismatched/plain previews use bounded literal text and retain exact details. Existing menu viewport bounds, reservation handlers, native fallback widths, signing/gateway/store logic and native state are preserved.
