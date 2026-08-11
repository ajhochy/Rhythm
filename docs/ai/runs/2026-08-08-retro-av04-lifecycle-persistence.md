---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-04]
status: stopped_for_aj_direction
tags: [retro, adherence, AV-04, security]
smoke_result: "decisive review failed; manual smoke was not reported"
verification_claimed: "ready_for_verification; focused checks and repair evidence recorded green"
divergence: false
overall_score: partial
---

# AV-04 lifecycle and persistence ordering retrospective

## Scope

Separate retrospective artifact only. It does not edit product code, the AV-04
contract, or the active AV-04 run note. The manager stopped after the two-repair
cap; AJ direction is required because a cross-user exposure remains.

## Per-criterion comparison

| Criterion | Contract status | Observed status | Category |
| --- | --- | --- | --- |
| av04-c1 | pass | Backend ordered-set isolation passed; the contract did not prove the client immediately hides prior-user state at auth loss. | C2 wrong contract |
| av04-c2 | pass | No separate hosted-data-source defect reported. | P aligned |
| av04-c3 | pass | Toolbar tabs can remain visible from the prior controller while logout/account transition is in progress. | C2 wrong contract |
| av04-c4 | pass | Initial picker/UI defects were repaired; no remaining picker defect reported. | P aligned after repair |
| av04-c5 | pass | Open/close preference PATCH completions can arrive out of order and restore stale intent. | C2 wrong contract |
| av04-c6 | pass | Initial overflow/ellipsis coverage was repaired; no remaining defect reported. | P aligned after repair |
| av04-c7 | pass | Neighbor focus recovery awaits preference persistence, so it is network-latency dependent rather than immediate. | C2 wrong contract |
| av04-c8 | pass | The stated user-switch stale-load check missed the render/auth-gate lifecycle: prior-user tabs/inventory can render before cleanup. | C2 wrong contract |
| av04-c9 | pass | Tests/goldens covered initial UI/a11y/race defects but omitted auth-transition visibility and out-of-order persistence completion. | C1 missing contract |
| av04-c10 | UNVERIFIED | Manual scope review remains required; no scope expansion is asserted here. | P |
| av04-c11 | pass | Initial composition defect was repaired; no remaining defect reported. | P aligned after repair |
| av04-c12 | pass | Focus target/selection coverage passed, but did not require focus to move before persistence resolves. | C2 wrong contract |
| av04-c13 | pass | Initial inventory/no-match copy defect was repaired; no remaining defect reported. | P aligned after repair |
| av04-c14 | pass | Request tokens discard late responses, but do not prevent already-held state from rendering above the auth gate. | C2 wrong contract |
| av04-c15 | pass | Initial conflict/golden defects were repaired; no remaining defect reported. | P aligned after repair |
| av04-c16 | pass | Same-ID request-token repair is valid, but it does not cover logout/account-boundary visibility. | C5 regression outside scope |
| av04-c17 | pass | Initial Dashboard-left-arrow defect was repaired; no remaining defect reported. | P aligned after repair |
| av04-c18 | pass | Required goldens were added, but none models a logout/account transition or delayed PATCH ordering. | C1 missing contract |

## Chain comparison

- **Expected chain:** intake-change-classification → context-pack → plan-spec-optional → acceptance-contract → implement-slice → conditional-quality-reviews → verification-gate → project-state-update → draft-pr → manual-smoke → manual-merge.
- **Observed chain:** acceptance registry, implementation, focused UI/a11y/race/golden review, two repair cycles, and green focused/full checks are recorded. The decisive review then found cross-user lifecycle exposure and persistence/focus ordering defects; the manager stopped at the repair cap.
- **Skipped skills:** no pre-stop stage bypass is established from the supplied evidence. Project-state update, draft PR, manual smoke, and manual merge did not run, appropriately, after the unresolved review findings.

## Issues

1. **C2 wrong contract — acceptance-contract / verification-gate:** user-scoped controller tests modeled stale responses but not the render boundary on logout or account replacement; detected by the decisive review showing prior-user tabs/inventory before cleanup.
2. **C1 missing contract — acceptance-contract:** no controlled delayed/open-close PATCH completion test established last-intent-wins locally and after persistence; detected by the decisive review's out-of-order preference race.
3. **C2 wrong contract — acceptance-contract / verification-gate:** keyboard-focus proof accepted eventual recovery even though the observable requirement is immediate local focus movement; detected by the focus path awaiting network persistence.
4. **P process — workflow-orchestrator:** the UI slice carried per-user persistence but was not explicitly classified as security/auth-lifecycle-sensitive, so the security review's fail-closed mindset did not target signed-out/inter-account rendering.

## Durable improvement proposal

Add a compact acceptance-contract rule for user-scoped optimistic UI: test that the auth gate hides retained state synchronously on logout/account replacement, and that delayed persistence completions cannot overturn the latest intent or delay local focus/navigation. This is narrowly justified by a security-sensitive repeated-repair failure; no product remedy is selected here.

## Next run

Before another repair attempt, add acceptance evidence with controlled auth and PATCH completers: observe an empty/safe surface immediately after auth loss, only the new account's data after replacement, final persisted/open-tab order matching the final user action despite reversed responses, and focus recovery before the persistence future completes.
