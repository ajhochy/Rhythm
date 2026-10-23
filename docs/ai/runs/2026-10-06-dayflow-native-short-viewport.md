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

## Files

- Follow-up: [issue #1605](https://github.com/ajhochy/Rhythm/issues/1605), generated body at `docs/ai/generated-issues/2026-10-06-dayflow-native-short-viewport-scroll.md`.
- Contract: `docs/ai/contracts/issue-1605.json` (3 isolated AppKit lifecycle tests; at the time of this original run, actual signed-app CUA remained manual and unverified; exact C9 CUA closure is recorded below).
- Harness: `apps/electron/test/native-dayflow-viewport-contract.mm` and `apps/electron/test/native-dayflow-viewport-contract.test.mjs`.
- Postmortem: `docs/ai/runs/2026-10-06-issue-1605-native-dayflow-postmortem.json`.
- Frozen native lifecycle fixture source SHA-256: `15426b7987b89773c0df74609efb02655f6b4cb7273b55146f6e7fcf0d9061a1`.

## Checks

- Baseline RED command: `RHYTHM_NATIVE_DAYFLOW_CONTRACT=1 RHYTHM_NATIVE_DAYFLOW_SOURCE=baseline node --test apps/electron/test/native-dayflow-viewport-contract.test.mjs`.
- Result: the native AppKit source compiled; 3 tests ran, C1 and C2 failed on behavior assertions, and C3 passed. The assertions confirm the frozen lifecycle has no owned `NSScrollView`, truncates the measured 558-point content to the 445-point viewport, and cannot expose document bottom content after resize. This is the required pre-implementation RED, not a product-green result.
- C1 exercises both the issue's 558-point measured content and a 700-point variant, so a fixed 558-point floor cannot satisfy the measured-content requirement by itself.
- Exact corrected TAP output: `/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-resume-final-state-draft/dayflow-native-appkit-red-final.txt`.
- Focused candidate result after the native lifecycle change: `RHYTHM_NATIVE_DAYFLOW_CONTRACT=1 node --test apps/electron/test/native-dayflow-viewport-contract.test.mjs` exited 0 with 3/3 passing against lifecycle SHA-256 `5658b5aaa17c20566f5619aed30bdc3546cdd1c45d09b6a61c78089a5cd974d2`. Receipt: `/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-resume-final-state-draft/dayflow-native-appkit-candidate-final.txt`.
- Root's combined focused native check passed 52/52 with this exact command: `RHYTHM_NATIVE_DAYFLOW_CONTRACT=1 /Users/ajhochhalter/.local/bin/node --experimental-vm-modules --test --test-concurrency=1 apps/electron/test/native-dayflow-viewport-contract.test.mjs apps/electron/test/native-dayflow-production-host.test.mjs apps/electron/test/dayflow-host-hooks.test.mjs apps/electron/test/stage-native-dayflow.test.mjs apps/electron/test/verify-packaged-native-dayflow.test.mjs`. TAP receipt: `/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-native-scroll-next-build/root-focused-native.txt`.
- An earlier invocation omitted the existing Node VM-modules flag and ended with 45 passing tests plus one test setup failure; rerunning with the exact command above produced 52/52. This was a runner invocation issue, not a product failure.
- GitNexus impact remains `UNKNOWN` for these untracked native lifecycle paths; manual impact was assessed MEDIUM. `detect_changes` reported no indexed changes, but the native untracked paths were excluded, so this is not evidence that no changes exist.
- Manual signed-app CUA evidence from root's C7 observation: at 1280×800, native host viewport y=229..674 (445 points); the clipped original native view did not move under two pages of wheel input. At 3440×1300, the 944-point pane showed all content. No physical-human input evidence is claimed.
- The prior 16/16 browser test run and C7 gate were green, and their records explicitly left native scrolling unverified. This postmortem records the missing native contract as C1; it does not reclassify browser-facade coverage as native verification.

## Notes

At the time of this original postmortem, the three executable lifecycle contract criteria were `pass` for the focused dirty-source checks, while signed-app acceptance remained pending. The AppKit test process used hidden local windows only; it did not start Rhythm/Electron, access DB/TCC/capture, or synthesize OS-wide input. Focus restoration, native input reachability, and physical-human evidence were not inferred from the fixture. Exact signed-app native CUA acceptance is now recorded in the final C9 section below; physical-human evidence remains separate and unrun.

## Final C9 native signed-app qualification

The earlier C7 observation above is historical: its signed UI showed a clipped original view that did not move under wheel input. C8 later produced a blank Dayflow UI at 1280×800; that failure remains documented separately in `issue-1605-c8-cascade-postmortem.json`. Exact C9 source `54888e924c5b31cb7700b6eb1f5da7c4c450e930` (apps tree `47f1828030f1b14c2175975e47e72a5796b0cb47`) now passes the signed normal-profile CUA check.

At 1280×800, the original Timeline appeared without the Rhythm-authored outer header/footer and retained its original controls. At 1280×560, two native macOS CUA scroll pages down reached Copy timeline, Settings, and Review cards while global navigation stayed fixed; two pages up restored Today/Timeline/Daily. At the tall target 3440×1300, macOS zoom produced an actual 3440×1296 window; all content remained visible and native wheel input did not move the outer document. The app was restored to 1280×800 with Timeline at the top. Receipt: `/Users/ajhochhalter/Documents/Codex/2026-10-06/codex-dayflow-cascade-c9-build/dayflow-C9-signed-native-CUA-receipt.json`; signed manifest SHA-256 `6302833146ba3edff3ffc31ae88d9c7e91d03ab454eca54ddf65e47d096915e9`.

The estimated short purple surface (402px), visible document extent (576px), and movement (174px) are screenshot approximations only. The public native getter does not expose exact `NSRect`/intrinsic geometry. This is native CUA evidence, not physical-human proof. Two existing pending approvals remained untouched; no approval, onboarding, TCC, capture, provider, or settings action was performed.
