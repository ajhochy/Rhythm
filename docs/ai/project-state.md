# Project state

## Current focus

Close exact C9 qualification for chat-bounded Coding Workflow and native Dayflow viewport behavior on `integration/2026-10-06-resume`, source `54888e924c5b31cb7700b6eb1f5da7c4c450e930`, apps tree `47f1828030f1b14c2175975e47e72a5796b0cb47`. C9 fixes CSS cascade specificity after the actual C8 signed app displayed a blank Dayflow surface.

## Active branch / PR

`integration/2026-10-06-resume` → draft PR #1604 against `main`. C9 repository, browser, formal live, signed-package, and actual native CUA qualification receipts are recorded. CI for final docs D will run after root pushes; human merge remains separate.

## In progress

Root owns final docs D review/commit/push, PR CI, and guarded worktree cleanup. The signed C9 app remains running at Dayflow 1280×800 with the Timeline at top. TestFlight 1.0.9 build 21 is valid and in internal beta; no new mobile build is needed for this desktop-only cascade change.

## Risks / known issues

Provider-semantic model behavior, a real human-native P256 approval fixture, physical phone testing, and the separate full native 16-screen matrix are unrun. CUA visual estimates are not direct private `NSRect` measurements. The C9 app is signed but not notarized. Do not describe PR CI as green until it runs on final docs D.

## Test status

C9 issue gate 4/4, PR gate 22/22, chat browser 1/1, Dayflow/Sol browser 16/16, and formal live API/fork/MCP 2/2 passed. Native AppKit C1–C3 and signed native Dayflow C4 passed; package, signing, stable-copy, verifier, signed smokes, strict-origin checks, and normal-profile launch all passed. Formal model/ranking responses were synthetic. See `runs/2026-10-06-chat-bounded-workflow-final-qualification.md`.

## Next step

Root reviews and pushes final docs D, checks resulting PR CI, then executes only the reviewed owned-cleanup plan. Keep C8 failure evidence and the manual merge boundary intact.
