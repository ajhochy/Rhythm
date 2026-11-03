---
date: 2026-10-10
repo: rhythm
branch: qualification/rhythm-r30-26bb1ff3
pr: null
issues: []
status: blocked
tags: [run, rhythm]
---

## Files

No implementation or workflow source changed. Exact reviewed local commit `26bb1ff3c2c16b64aeeb493a8faeaa0c23217cd7` was published to the new qualification branch with explicit AJ authorization. Existing unsigned artifact and old receipts remain preserved.

## Checks

Dispatched Electron Release workflow `336520339` once:

```sh
gh workflow run 336520339 --repo ajhochy/Rhythm \
  --ref qualification/rhythm-r30-26bb1ff3 \
  -f version=0.1.0-r30.26bb1ff3 \
  -f qualification_only=true -f prerelease=true
```

[Run 38064672607](https://github.com/ajhochy/Rhythm/actions/runs/38064672607) verified exact head SHA. Both hosted architecture jobs failed `Test unsigned package contracts`: arm64 completed 15:46:29 UTC; x64 completed 15:53:19 UTC. Each engine-package suite passed 10/10; each unsigned package suite reported 25 passed, 10 failed, 3 skipped. Signing, notarization, artifact upload, and release publication were skipped. Artifact API returned zero artifacts. No signed/notarized or runtime qualification is claimed.

## Notes

The watcher chose a nonnumeric version suffix without checking the packager's numeric-only validation. This input was rejected before package creation. An independent test that supplied its own valid version proceeded further and failed because the workflow does not provision the required signed Dayflow.app through `RHYTHM_DAYFLOW_APP_DIR`. Correcting only the version cannot resolve that independent prerequisite. No duplicate dispatch, source repair, or retry was launched.

Evidence and both complete job logs are under `/Users/ajhochhalter/Documents/Codex/2026-10-09/rhythm-watch/`; final receipt is `approved-CI-qualification-final-failure.json` with log hashes. Existing CI credential validity was not tested because signing was never reached. The normal host public identity query separately confirmed local Aaron Hochhalter Developer ID identity `CF6C1EF1525E70E6E3324388A322938977779DB7`, team `56Q69NYP9H`; the earlier zero-identity restricted query did not establish absence on the host.

No GitHub release, merge, installation, local app launch, or replacement of AJ's remaining open app occurred. Coordinator delivery-only live API acceptance remains passed; protected evaluator/full A6 remain separately unverified and assigned to the existing sole executor.

### Bounded recovery preparation

Read-only investigation established the concrete provision source. Existing `/Users/ajhochhalter/Applications/Dayflow.app` is version 2.6.0/build 133, team `L75WYD8X4Y`, deep signature valid and Gatekeeper accepted as Notarized Developer ID. Its executable SHA-256 `1d8ecda4fdffa42e79c0540829df3093e1eca11f1cc8354c8fe2eeda769dff50` matches the retained review app payload. The official `https://dayflow.so/appcast.xml` references `https://github.com/JerryZLiu/Dayflow/releases/download/v2.6.0/Dayflow.dmg`; official release asset metadata reports size 102775608 and SHA-256 `ec7ff77127eb5cd6bd6507b2f2889acd5710eaf4bfb41e0c613a1d9ff735e73c`. The DMG has not been downloaded or independently hashed here.

The existing Dayflow validator explicitly refuses any target except arm64. Thus merely provisioning Dayflow cannot make the current x64 matrix valid. A proposed workflow and patch were saved outside the source tree in `rhythm-watch/electron_release-qualified-Dayflow-PROPOSED.yml` and `.patch`: numeric-version preflight, arm64-only qualification matrix, and exact official DMG/hash/read-only mount/fresh-copy/unchanged real artifact validator before builds. YAML parsing passed; the frozen original workflow remains unchanged. Ordinary release matrix is unchanged and its unsupported x64 issue is not claimed repaired.

The current full-release signing script requires the Hermes manifest private key. Its CI secret name exists, but validity is untested. The retained factory Hermes artifact is pinned to `13ade17847a0225dc95b79d9ed5c9c6afc8bc083`; no local manifest signature or manifest-key environment/reference was established. Supported local sign-only mode needs no factory manifest key, but is not notarization and does not satisfy the requested signed/notarized outcome alone. No admission gate was bypassed. The proposed repaired CI route uses the already-configured secret name and requires a reviewed new commit plus separate approval for the next qualification run; no second run or new material upload occurred. Detailed plan: `rhythm-watch/signed-candidate-shortest-supported-recovery-plan.json`.

### Revised proposal after independent review

The initial JSON matrix proposal would fail the existing literal architecture contract and its unconditional provisioner would affect ordinary releases. Version 2 preserves the ordinary literal arm64/macOS-14 and x64/macOS-15-intel matrix. The normal job runs only outside qualification; a separate arm64 qualification job reuses the exact environment and steps through supported YAML aliases. New version preflight and Dayflow provisioning are each qualification-only, so normal releases skip them. The pre-existing normal-release x64/Dayflow incompatibility is explicitly retained as unresolved; no architecture policy redesign or silent support removal.

Actual bounded verification used a fresh synthetic source copy at `/private/tmp/rhythm-electron-CI-contract-v2-01`, exact unchanged `electron-e10-engine-package.test.mjs`, pinned existing Node 22, network-denied root guard, and unlink allowance only inside that fresh test tmp directory. Command:

```sh
/usr/bin/sandbox-exec -f /private/tmp/rhythm-electron-CI-contract-v2-01/guard.sbpl \
  /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  HOME=/private/tmp/rhythm-electron-CI-contract-v2-01/home \
  TMPDIR=/private/tmp/rhythm-electron-CI-contract-v2-01/tmp \
  /Users/ajhochhalter/.hermes/node/bin/node --test \
  /private/tmp/rhythm-electron-CI-contract-v2-01/fixture/apps/electron/test/electron-e10-engine-package.test.mjs
```

Result: exit 0, 10 passed, zero failed/skipped, 1957.824291 ms. The suite compiles/executes only controlled C version fixtures; no app, real engine, host API, network, or unfiltered test suite ran. Parsed-configuration assertions passed 8 checks: preserved normal matrix/environment/original steps, qualification-only additions, arm64 qualifier, shared step/environment aliases, mutually exclusive jobs. Both new shell bodies passed Bash syntax checks; seven actual guarded numeric-version cases passed, including acceptance of `0.1.0` and rejection of the bad suffix. The provisioner itself was not executed. Frozen source remains clean.

Reviewable files: `rhythm-watch/electron_release-qualified-Dayflow-PROPOSED-v2.yml`, `.patch`, and `qualification-workflow-v2-contract-PASS.json` with hashes/log paths. The original proposal is retained as superseded evidence. No changed commit was pushed or CI run dispatched. Official downloaded artifact, CI credentials, later signing/notarization and runtime gates remain unverified.

### Version convention correction

AJ rejected the proposed `0.1.0` fallback because it does not follow the established version series. Actual remote releases include `electron-v0.18.60`, `.61`, `.62`, `.63`, and latest `electron-v0.18.65` (published 2026-09-29). Retained successful CI proof `.proof/mega-2026-09-18/final-signing-ci.json` captures `rhythm-electron-macos-{arm64,x64}-0.18.65`, and signed-arm64 metadata records app version `0.18.65`. Older run-log API fetches returned HTTP 410; these retained records and the live release API are the evidence, not a newly retrieved historical dispatch transcript.

The proposed next input is **`0.18.66`**: both numeric app plist versions become `0.18.66`; the existing workflow derives **`electron-v0.18.66`** and qualification artifact name `rhythm-electron-macos-arm64-0.18.66`. Neither proposed tag was present in the remote read-only check. Qualification-only mode creates no Git release tag or release. The new numeric preflight accepts this established convention; actual guarded Bash execution passed, as did the regex extracted from the frozen packager. Tag prefixes and commit suffixes are not numeric version inputs.

Engine build identity remains `0.0.0-rhythm-<exact checked-out 40-hex commit>`, not a fabricated tag or new build-number scheme. The existing artifact is tied to `26bb1ff3`; a new workflow-repair commit has not been created, so its exact future build SHA cannot yet be stated. The earlier `0.1.0` retry proposal is superseded, while its historical test evidence is retained. Version correction is not approval for another dispatch/push/tag/signing action. Exact decision receipt: `rhythm-watch/established-Electron-version-0.18.66-decision.json`.
