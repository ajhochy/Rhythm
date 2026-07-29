# Project State

## Current focus

2026-07-28 MEGA PR run complete: 16 issues implemented, verified, and merged into one integration branch. Draft MEGA PR against `main` awaiting human review + manual smoke. Details: [runs/2026-07-28-mega-pr-run.md](runs/2026-07-28-mega-pr-run.md).

## Active branch / PR

- Branch: `mega/run-2026-07-28` @ `6fe8edda9` (11 group branches merged; per-group worktrees under `.worktrees/`, git-excluded)
- PR: [#1241](https://github.com/ajhochy/Rhythm/pull/1241) (draft). **Do not merge — manual human review + smoke required.**

## In progress

- Nothing in flight. All 11 implementation groups landed: scheduler (#1213 #1222 #1214), mcp-status (#1216 #1217), mcp-catalog (#1220 #1221), proposals (#1223), memory (#1218 #1215), gallery (#1208), profile-editor (#1236), mobile-access (#1239), mobile agents/model-picker/tools (#1232 #1233 #1234).

## Risks / known issues

- `issue_1186_sandbox_foreground` is load-flaky on unmodified main — filed #1240.
- Desktop visual click-through deferred to human manual smoke (orchestrator cannot launch a second desktop instance while the live app owns port 4001 / real DB).
- #1214 quarantine stops future prod scheduler ticking; existing legacy prod rows need the manual operator procedure in docs/release/hosted_deployment_synology_cloudflare.md.
- iOS epics #1170–#1173/#1231 deferred (overlap with this run's corrective issues); #1209 (fork rebuild) and #1219 (design-first, post-MEM-OKF re-scope) deferred; release gates #1197–#1200 need human/hardware.

## Test status

Final tip `6fe8edda9`: api_server 3631✓/1 known-flake, build ✓ · mcp_server 108✓ + tsc ✓ · flutter 1006✓ + macos debug build ✓ · mobile static ✓ + Playwright e2e 55✓ · checks --level issue exit 0 · live e2e suites 5/5 + scheduler live evidence against isolated sandboxes.

## Next step

Human: review the draft MEGA PR, run manual desktop smoke (Settings→Mobile Access, Gallery MP4 posters, Agent Profile capability editor), then merge on GitHub. After merge: run the manual operator procedure for legacy prod scheduler rows; consider a follow-up run for the deferred iOS epics.
