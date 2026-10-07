---
date: 2026-10-05
repo: Rhythm
branch: unavailable (isolated source snapshot has no .git)
pr: null
issues: []
status: unverified
tags: [run, rhythm, electron, dayflow]
---

# Dayflow companion bundle

### 2026-10-05 — dayflow-bundle

- Files modified: added the Dayflow signed-artifact validator/stager and focused Node tests; wired package staging and production signing exclusion; added upstream MIT license and external-notice handling.
- Checks run: `node --check apps/electron/src/dayflow-desktop-artifact.mjs`, `node --check apps/electron/scripts/package-mac.mjs`, and `node --check apps/electron/scripts/sign-and-notarize-mac.mjs` exited 0. `node --test --test-concurrency=1 apps/electron/test/dayflow-desktop-artifact.test.mjs` passed 6/6.
- Decisions made: [retain upstream Dayflow signature](../decisions/2026-10-05-dayflow-bundle.md). The stager's injected command executor is used only for unit rejection/argument tests; it is not evidence of a trusted macOS signature check.
- Deviations from spec: none.
- Concerns: this isolated source snapshot has no `.git`, so GitNexus impact/detect-changes and branch/commit evidence could not run. The supplied original-repository impact result was LOW (one direct caller each) for `findNestedCodeSignTargets` and `stageHermesDesktopArtifact`; bounded package/sign call-site inspection was used here.

## Remaining release validation

No full package, signing, notarization, installation, or app launch was attempted. A normal signed-package validation still needs a macOS arm64 release environment with the legitimate upstream app supplied explicitly as `RHYTHM_DAYFLOW_APP_DIR`, the required Hermes/Colony artifacts, and the existing signing/notarization credentials. It must demonstrate source and staged `codesign --verify --deep --strict -R <exact requirement>`, `spctl --assess`, outer signing without Dayflow re-signing, and final outer `codesign --verify --deep --strict`.

The external legal directory includes the full upstream MIT license. The Dayflow app's actual dependency/font notice inventory was intentionally not read from a user installation in this isolated task. Packaging copies recognized regular notice files from the supplied app to `Resources/dayflow-desktop/legal/upstream-app-notices/`; legal review must provide any required attribution absent from the pinned-source legal material before distribution.

### 2026-10-05 — verification syntax repair and legal provenance

- Real verification failure: the parent release-stage orchestration (`verify-dayflow-stage.mjs`, run outside this sandbox) rejected the first implementation because `codesign -R <bare requirement>` interpreted the requirement text as a filename. The six synthetic tests did not detect this macOS CLI requirement-source rule.
- Repair: the requirement is now passed as `-R`, `=<exact requirement>`, retaining every identifier, Team ID, Apple anchor, and Developer ID OID predicate. The focused test asserts the exact leading-`=` argument and rejects a bare requirement argument.
- Legal material: added the supplied pinned-source `THIRD-PARTY-NOTICES.txt`, `notice-sources.json`, `Package.resolved`, and individual dependency/font licenses to `apps/electron/legal/dayflow/`. Staging copies every regular file in that directory to the external sibling `Resources/dayflow-desktop/legal/`; it does not modify `Dayflow.app`. Package-lock revisions cover GRDB, NetworkImage, PostHog, Sentry, Sparkle, swift-cmark, and swift-markdown-ui. Google Fonts OFL notice copies are included without asserting font-binary revision equivalence.
- Checks run after repair: `node --check apps/electron/src/dayflow-desktop-artifact.mjs` exited 0; `node --test --test-concurrency=1 apps/electron/test/dayflow-desktop-artifact.test.mjs` reported 6 tests, 6 pass, 0 fail.
- Remaining: parent must rerun the real staged-artifact receipt. The installed app's notices are supplementary and are not claimed as sufficient legal clearance by themselves.

### 2026-10-05 — Sol review: symlink-alias signing repair

- Review finding: lexical Dayflow-root exclusion did not protect a sibling symbolic link whose target was `Dayflow.app/Contents/MacOS/Dayflow`; `isMachO` opens its input and would follow that link, adding foreign code to the `codesign --force` target list.
- Repair: moved the actual nested-target traversal to the Dayflow artifact module used by `sign-and-notarize-mac.mjs`. It skips every symbolic-link `Dirent` before traversal or Mach-O inspection, then applies the Dayflow subtree exclusion. Real directories—including canonical framework `Versions/A` paths—continue to be scanned.
- Regression evidence: a fixture creates the foreign Dayflow executable, a sibling symlink alias to it, real `opencode`, approval-helper, Hermes, Colony, and framework Mach-O files. The actual `findNestedCodeSignTargets` output excludes the alias and all Dayflow descendants while retaining every real sibling target.
- Legal evidence: all ten `LICENSE-*.txt` files referenced by `notice-sources.json` are present as raw copies in `apps/electron/legal/dayflow/`; a SHA-256 check against the manifest reported `notice-source hashes verified: 10`.
- Checks run: `node --check apps/electron/src/dayflow-desktop-artifact.mjs`, `node --check apps/electron/scripts/sign-and-notarize-mac.mjs`, and `node --test --test-concurrency=1 apps/electron/test/dayflow-desktop-artifact.test.mjs` exited 0; test output was 6 tests, 6 pass, 0 fail.
- Remaining: parent physical staging receipt and Sol re-review are still required. No upstream Dayflow app was re-signed, launched, or inspected for user data.
