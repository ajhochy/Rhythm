---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-electron-approval-queue-20261001
pr: 1598
issues: [E1]
status: unverified
tags: [run, Rhythm]
---

## Files

Recovered the existing approval-queue candidate after Rhythm was stopped. Independently read its complete four-file product diff and original acceptance receipt. Corrected PendingApproval.decisionNonce to the actual API string-or-null shape, allowed null legacy rows without discarding valid siblings, guarded the decision handler before signing, disabled legacy buttons with a request-again explanation, and mounted a metadata-only live count outside the closed menu. Signing, HTTP capability and API authorization rules are unchanged.

## Checks

- Before edits, the two unchanged Playwright legacy/closed-bell tests failed at missing legacy card and missing live announcement.
- Full existing E1 browser contract: 15 passed in 58.0s. Command from apps/web: `env HOME=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e1-approval-client-home ./node_modules/.bin/playwright test --config tests/e1-approval-queue-playwright.config.ts`.
- `npm run build`: PASS (TypeScript and Vite). Existing large chunk warning.
- GitNexus before edits: PendingApproval CRITICAL402 symbols/3 direct importers; disclosed to user before edit. Shell LOW4; createLiveApprovalGateway LOW3; exact Function decideApproval LOW0. Graph misses context-function callers; manually traced Shell and shared store. Current user requested fixing and finishing interrupted workflows; AGENTS requires risk disclosure, and no new signature authority was introduced.

## Notes

Source/browser candidate only. Pending: independent review; native signer/auth/negative checks; real isolated API/native gesture/readback and final same-source signed installed app. Existing approvals remain undecided. No commit, push, main merge, production deploy, or installed app restart performed. Older exact approval-gate receipts are preserved as history; no user approval row/signature is fabricated by this source repair.

## Independent review follow-up: slow reads and durable decision errors

Review found two narrow regressions in the shared approval state. A visible-window poll every five seconds incremented the response generation even while the previous healthy GET was still pending (gateway timeout: ten seconds), so a consistently 6.2-second GET never published cards. A failed native decision set the same error field used by GET; the next successful queue read erased that actionable decision failure. Added browser tests for both before editing; both failed at the expected missing card/error. The existing late-older-response test then showed that manual Refresh must queue a new read behind the single in-flight request.

- `store.tsx`: automatic reads now share one in-flight promise without advancing generation; an explicit manual/decision refresh fences and queues one follow-up read after it. A separate `decisionError` persists across successful GETs and clears only after an actual successful decision. `Shell.tsx` uses status wording valid for either read or decision failure. The existing gateway, native signer, API authorization, and `PendingApproval` validation were not changed in this follow-up.
- Focused three browser cases (slow GET, late older refresh, failed decision then healthy GET): 3 pass, 0 fail. Full E1 browser command from `apps/web`: `env HOME=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e1-approval-client-home ./node_modules/.bin/playwright test --config tests/e1-approval-queue-playwright.config.ts` → 17 pass, 0 fail (1.1 minutes). `npm run build && npm run test:dist-smoke` → exit 0; existing large-chunk warning. `git diff --check` → exit 0.
- GitNexus upstream before follow-up edits: `FixtureProvider` MEDIUM/9 (7 direct), exact function `decideApproval` LOW/0; `Shell` LOW/4 (1 direct). No HIGH/CRITICAL new symbol touched. The previously disclosed `PendingApproval` CRITICAL schema edit predates this follow-up.

Still unverified: actual API/native signed-gesture readback, auth/security negatives on this final E1 source, and installed signed app. Browser fixtures do not decide real approvals. This is an uncommitted source candidate, not integration acceptance.
