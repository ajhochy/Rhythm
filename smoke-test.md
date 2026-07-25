# Smoke Test

Scope: issue #1174, complete mobile OpenCode 1.14.49 API parity.
Date: 2026-07-25

## Findings

- The bundled OpenCode contract contains exactly 133 operations: 75 surfaced,
  10 internal, 7 alternate, and 41 intentionally omitted. The generated mobile
  gateway admits 83 operations and denies 50.
- Mobile now exposes approved workspace search/VCS/project, session maintenance,
  PTY, skills/config/schema/resource, and MCP authorization-removal surfaces.
- Only genuine, non-synthetic user text can be edited or deleted. Shell-generated
  synthetic user records remain visible history but cannot become mutation
  targets.
- Session initialization now supplies a fresh OpenCode ascending message ID.
  The live gate proved that init reaches the configured model; reusing the
  previous user ID silently skipped the model turn.
- The final behavioral run used a throwaway HOME and SQLite database on API
  `54174`, rebuilt fork `55174`, and local Anthropic-compatible fixture `56174`.
  All processes were stopped, all ports were confirmed free, and the sandbox
  was deleted.

## Checks

| Area | Behavior | Command | Result |
| --- | --- | --- | --- |
| Contract | Every bundled operation has one classification and the generated allowlist matches it | `npm run contract:check && npm run test:contract && node tests/issue-1174-opencode-parity-contract.test.mjs` | Success: contract green; #1174 3/3 |
| Security | Prefix/auth preservation, bounded errors, recursive config redaction, synthetic mutation exclusion, ascending init IDs | `npm run test:security:1174` | Success: 5/5 |
| Mobile static | Lint, typecheck, utility and persistence suites | `npm run test:ci:static` | Success |
| Fake engine | OpenCode 1.14.49 fake-server contract | `npm run test:fake-server:self` | Success |
| API proxy | Generated allowlist, scoping, limits, denials, compatibility, and log redaction | `npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts` | Success: 9/9 |
| Browser | Full mobile web suite, including genuine-message selection after a synthetic shell turn | `RHYTHM_MOBILE_E2E_WEB_PORT=19174 RHYTHM_MOBILE_E2E_FAKE_PORT=44174 RHYTHM_CAPTURE_SCREENSHOTS=1 npx playwright test` | Success: 28/28 |
| Visual | Workspace, chat maintenance, terminal 32×120, skills, models/config, and MCP OAuth removal screenshots | Six PNGs under `apps/mobile/test-results/issue-1174-*` | Success: visually inspected |
| Native bundle | Current iOS Hermes bundle and assets | `npx expo export --platform ios --output-dir dist-ios-1174 --clear` | Success |
| Real behavior | Pairing, project init/update, VCS, actual PTY resize, genuine prompt, session init/model response, part/message mutation, inspection, and exact denied alternates | `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1174_mobile_opencode_parity_live.test.ts` | Success: 1/1 in 5.58s |
| Repo gate | Flutter analyze/format plus API and MCP typecheck | `ai-workflow checks --level issue` | Success |
| Impact | Changed-symbol and execution-flow scope | `npx gitnexus detect_changes --scope all --repo Rhythm-1174` | LOW: 8 files, 12 symbols, 0 processes |
| Independent review | UI/provider mutation guards, init ID parity, and live coverage | Re-review through `5e848c7ea` | Success: no actionable findings |

## Recovery notes

- The first strengthened browser flow tried to delete a message after deleting
  its only genuine part. Once synthetic fallback was correctly removed, the
  panel disappeared. The test now deletes one genuine message, creates another,
  and deletes that second message's part.
- Live diagnostics corrected assumptions about non-Git project identity,
  macOS `/tmp` canonicalization, caller-supplied PTY roots, and idle status
  omission. No engine source change was retained.
- The live fixture exposed the stale session-init message ID defect. A native
  OpenCode-format ascending ID generator fixed it, and the final fixture
  received both the genuine prompt and init turns.
- The PR-level workflow reproduced the unrelated base-only #723 dynamic-import
  VM failure. The aggregate branch already contains that test seam and has
  green full-gate evidence; #1174 does not edit #723.

## Known gaps

- None for issue #1174.
