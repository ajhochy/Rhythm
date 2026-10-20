---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: in_progress
tags: [run, rhythm]
---

# Dayflow recovered source and new native stage

## Files

- Historical source manifest: `/private/tmp/rhythm-dayflow-recovered-inputs-20261020/source-manifest.json` (SHA-256 `c1b5c5e05292122ef0a10d5816dcafbe9fd1f0d40c0262d5907de7eb93b1c86d`). The historical source archive and compiled stage were not recovered.
- New immutable source input: `/private/tmp/rhythm-dayflow-recovered-inputs-20261020/new-source-input` and `new-source-manifest.json` (SHA-256 `dbb8dec46a8bb125e29c7c52596de063df12fd9d1ddf58718bf9c2b94a25a4ec`). Of 749 source files, 747 match the historical manifest in bytes, hash, and recorded mode. `ownership.md` and `production-builder-preparation.md` are newly authored recovery documents at the two unavailable historical paths and are marked as such in the new manifest. The historical manifest and 747-file recovery tree remain unchanged.
- Disposable build tree: `/private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy`. Its only source difference from the new input was a single obsolete Electron runtime path in `scripts/build-production-native-host.sh`, replaced with the existing same-version Electron 40.10.2 runtime path. Adaptation receipt: `build-copy-adaptation.json`; adapted script SHA-256 `790c554400d95b9c1640b6251cda21a202e10b63bd16d0e84800bf61f8394e84`.
- Fresh stage: `build-working-copy/Host/stage-production`, with 280 payload files and `MANIFEST.sha256` SHA-256 `39b792c003e0c9b16c94eaba38009b1e0a1ccbadd660bde8d825a7239e9d1e32`. Fresh signing-inputs receipt: `new-native-dayflow-signing-inputs.json` SHA-256 `ffe252f4a4e8699d1d513d339c791d13fe9fc9fbab05ad0e22050275711a8e98`. Proposed rpath metadata: `new-signing-layout-metadata-proposal.json` SHA-256 `db34226f90a4512f72296f97e2e662487e8780a6757b41ff28274be41302a89b`.

## Checks

- Independent input verifier found exactly 749 regular files, no symlinks, zero new-manifest mismatches, and exactly the two explicitly replaced historical document hashes. The source was reverified unchanged after the build. Build-copy source differed only at the recorded runtime-path adaptation.
- Guarded compile-only command, exit 0; complete 13,571-line output retained at `/private/tmp/rhythm-dayflow-new-source-native-build-2026-10-20.log`:

  ```sh
  npm run build:guard -- \
    --watch /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/DerivedData \
    --watch /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/ModuleCache \
    --watch /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/Dependencies \
    --watch /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/Host \
    -- /bin/zsh -f -c '/private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/scripts/build-production-native-host.sh && /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/scripts/build-rhythm-dayflow-helper.sh && /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/scripts/stage-production-native-artifacts.sh'
  ```

- The production Swift library, Node-API host addon, and helper compiled; the staging script checked its public backend metadata, font/license payloads, and macOS 14.0 minimums. Guard peak was 9,626,691,545 bytes, below the default 10 GiB cap. Swift concurrency warnings were emitted; compilation succeeded.
- `shasum -a 256 -c MANIFEST.sha256` passed for all 280 stage files. The staged addon, dylib, and helper bytes matched their compile outputs, and staged resources were identical to the compiled resource bundle. `Host/artifacts-production/production-build-receipt.txt` was retained. The fresh signing-inputs generator checked every stage file and manifest line, the unchanged 280 relative paths and signing classes, and the exact recovered sidecar SHA-256 `3659bb1bafabb43e9fb899890de68498dadb8d3d93e814edefc2d1f2118d4db2`.
- Actual staged rpaths: addon `@loader_path` plus its `DerivedData` debug path; dylib/helper each `/usr/lib/swift`, `@loader_path`, and the Xcode Swift 6.2 toolchain path. All three report minos 14.0. The reviewed metadata proposal removes only the respective development path on future packaged copies.
- After stage verification, deleted only this disposable build copy's `DerivedData`, `ModuleCache`, and `Dependencies`, reclaiming 4,977,960 KiB (4.747 GiB) logical. The stage, host build and receipt, source, manifests, and logs remain. Shared guard measurement then was 4,615,160,144 bytes with 6,122,258,096 bytes (5.702 GiB) of headroom and no active run.

## Notes

This is a **new** source build and unsigned stage. It is not the missing historical archive, byte-identical historical stage, independently accepted build, signed package, installed app, or live behavior proof. The old 749-file source manifest and 280-file signing-inputs JSON remain immutable evidence, and their old acceptance status is not reused.

The tracked Rhythm wrapper must be compiled separately after the integrated checkout's source and HEAD freeze. It will pin the new source/stage inputs, compile the tracked wrapper against the staged dylib, and produce its own receipt. A later package layout must replace only the old staged addon with the tracked wrapper output, include the verified sidecar, and record new actual 280-row layout hashes. The measured rpath proposal must be confirmed against the tracked wrapper before packaging. No wrapper, package, signing, install, or runtime launch has been performed in this recovery run.

Prepared wrapper command (pending checkout freeze; run from this Rhythm worktree, with a fresh nonexistent output directory):

```sh
npm run build:guard -- \
  --watch /private/tmp/rhythm-dayflow-tracked-wrapper-20261020 \
  -- node apps/electron/scripts/build-native-dayflow-wrapper.mjs \
  --baseline-source-root /private/tmp/rhythm-dayflow-recovered-inputs-20261020/new-source-input \
  --source-manifest /private/tmp/rhythm-dayflow-recovered-inputs-20261020/new-source-manifest.json \
  --source-manifest-sha256 dbb8dec46a8bb125e29c7c52596de063df12fd9d1ddf58718bf9c2b94a25a4ec \
  --signing-inputs /private/tmp/rhythm-dayflow-recovered-inputs-20261020/new-native-dayflow-signing-inputs.json \
  --signing-inputs-sha256 ffe252f4a4e8699d1d513d339c791d13fe9fc9fbab05ad0e22050275711a8e98 \
  --stage /private/tmp/rhythm-dayflow-recovered-inputs-20261020/build-working-copy/Host/stage-production \
  --stage-manifest-sha256 39b792c003e0c9b16c94eaba38009b1e0a1ccbadd660bde8d825a7239e9d1e32 \
  --node-headers /Users/ajhochhalter/.electron-gyp/40.10.2/include/node \
  --out /private/tmp/rhythm-dayflow-tracked-wrapper-20261020
```
