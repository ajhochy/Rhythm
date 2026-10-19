# Rhythm — project state

## Current focus
Local qualification of the mega candidate, with the Grid/Luna simple-edit calibration corrected. See [calibration run](runs/2026-10-19-router-calibration-fix.md) and [feature inventory](plans/2026-10-19-feature-test-inventory.md). This is scoped router evidence, not overall mega/release qualification.

## Active branch / PR
- Work branch: `test/feature-playwright-2026-10-19`, based on mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
- Tested product source: `d7fb554735f93c0d0a76785cbadd583d0f866610` (calibration change in `e7fa976251`). Later changes are test clarification/results only.
- Local signed app: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app`, 0.18.83. Installed `/Applications/Rhythm.app` preserved.
- Existing integration target remains mega / PR #1598. No new PR, push, merge, release or installation in this task. `main` changes require AJ approval.

## In progress
- Review/integrate the local calibration candidate when authorized. Default edit/feature boundary is now 1.5; easy/frontier boundaries and conservative rules fallback remain unchanged.
- Continue the remaining feature qualification/repairs from the inventory. P1/P2 remain at their checkpoint except the explicitly promoted router family.
- Consolidation/release follow-ups remain in [consolidation record](runs/2026-10-19-branch-worktree-consolidation.md); preserved archive tags/work must not be deleted.

## Risks / known issues
- Background Google Calendar/Gmail/Planning Center sync can log missing OAuth server-configuration errors in this local app. One intermediate router run caught them; no settings, credentials or error allowlist were changed to hide them.
- Prior Tasks retry error-screen and unassigned Advanced branch-request defects remain; primary/Coordinator/approval fixtures still have qualification gaps. Inline code-edit proof does not qualify repository editing or Coordinator/tool workflows.
- Existing Auto chats retain their first routing decision. Explicit grid overrides remain authoritative. The current profile has no grid override; Personal was reauthorized by AJ and is eligible again.
- Matching dependency stores are symlinked in this worktree; never run install/ci through those links. All builds used the shared 10 GiB guard. GitNexus index is stale and rooted at the original checkout; direct diff review supplements it.

## Test status
- Revised candidate: 649 decision tests, strict packaged TypeScript, issue checks, red/restored-green calibration regression, isolated real HTTP/default-policy check, local package/signature verification and final **17/17 router Playwright cases pass**. Difficulty cases use the real bundled Luna Decisions client; the inline edit is served by Haiku at tier 3 with response/reload assertions.
- Full aggregate PR command initially failed 7 of 22 batches: new test JSON typing, a known sandbox temporary-root fixture, and missing mobile dependencies. Type-only/harness repairs and scoped reruns cover those failures; the aggregate command was not rerun, so there is no clean one-shot PR-gate receipt.
- Original seven-family P0 run at mega 894c16f: 10 pass / 10 product-or-log failures / 13 UNVERIFIED. Those non-router cases were not rerun against d7fb554735; do not combine source versions into an overall green claim.

## Next step
Review the calibration diff and updated local build, then continue remaining mega qualification. Integration, any `main` update, production deployment and installed-app replacement remain separate AJ-authorized actions.
