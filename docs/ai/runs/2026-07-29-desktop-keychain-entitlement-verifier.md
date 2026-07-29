---
date: 2026-07-29
repo: Rhythm
branch: codex/fix-desktop-keychain-entitlement-verifier
pr: 1250
issues: []
status: ci-pending
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Desktop keychain-entitlement verifier repair

## Files changed

- `tools/release/verify_desktop_oauth_build.sh` now requires exactly one signed
  app keychain group matching `${TeamIdentifier}.${CFBundleIdentifier}` while
  continuing to reject the incorrect
  `com.apple.security.keychain-access-groups` entitlement key.
- `tools/release/sign_and_notarize_macos.sh` now expands
  `$(PRODUCT_BUNDLE_IDENTIFIER)` (read from the built app's
  `Info.plist:CFBundleIdentifier`) in addition to `$(AppIdentifierPrefix)`.
  The failed run's "Dump signed entitlements" step proved the signed app
  shipped the literal group `TEAMID.$(PRODUCT_BUNDLE_IDENTIFIER)` — the
  April-era sed predates e0bdd587a's two-variable entitlement and only
  expanded the prefix. Without this, the repaired verifier would correctly
  fail the next release on the group mismatch.
- `apps/api_server/src/__tests__/skill_schema_parity.test.ts` keeps the release
  entitlement, signer expansion, and verifier contract aligned in the test
  explicitly run by the Desktop Release workflow.
- `docs/ai/project-state.md` records the current release state and next action.

## Checks run

- Clean `origin/main`: `ai-workflow checks --level issue` — passed.
- Red regression: `npx vitest run src/__tests__/skill_schema_parity.test.ts` —
  failed on the stale verifier's missing app-scoped validator.
- Post-fix regression: same command — 13/13 passed.
- `bash -n tools/release/verify_desktop_oauth_build.sh` — passed.
- `shellcheck tools/release/verify_desktop_oauth_build.sh` — passed.
- Signer follow-up: red regression on the missing
  `$(PRODUCT_BUNDLE_IDENTIFIER)` expansion, then 13/13 after the sed fix;
  `bash -n` + `shellcheck` on `sign_and_notarize_macos.sh` passed; sed dry-run
  against `Release.entitlements` produced
  `TEAMID.org.visaliacrc.rhythm` at `keychain-access-groups:0` and
  `plutil -lint` passed on the processed plist; `tsc --noEmit` passed.
- `ai-workflow checks --level issue` — passed.
- `ai-workflow checks --level pr` — all configured Flutter, API, MCP,
  opencode-fork, and mobile checks/builds passed.
- GitNexus compare-`origin/main` — LOW risk, zero affected processes.

## Notes

- Draft PR: [#1250](https://github.com/ajhochy/Rhythm/pull/1250).
- Failed release run
  [`30490564260`](https://github.com/ajhochy/Rhythm/actions/runs/30490564260)
  completed build, package, signing, notarization, and the bundled-server smoke
  before failing `Verify signed desktop OAuth build` with
  `unexpected entitlement 'keychain-access-groups' present`.
- Root cause: commit `e0bdd587a` intentionally added the app-scoped entitlement
  for `HumanApprovalSigner`, while the older release verifier still prohibited
  it.
- The signer entitlement was preserved. Removing it would break the production
  Data Protection Keychain/Secure Enclave signing path.
- No formal issue acceptance criteria were supplied; no acceptance-contract
  artifact was created.
- No server/live API, UI, or packaged-runtime smoke was required because this
  branch changes release validation only.
