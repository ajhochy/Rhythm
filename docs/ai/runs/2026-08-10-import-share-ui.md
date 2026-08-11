---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: [1339]
status: verification
tags: [run, Rhythm, live-artifacts, import, sharing]
---

# Import and sharing UI — Slice F

## Files

- Added acceptance contracts for HTML import and #1339 sharing UI.
- Added `import_share_contract_test.dart` before implementation.
- Threaded `AuthSessionService.currentWorkspace!.id` through `AppShell` into
  `DashboardArtifactWorkspace`; HTML creation posts that hosted workspace ID.

## Checks

```text
export PATH="$HOME/development/flutter/bin:$PATH"
cd apps/desktop_flutter && flutter test test/features/live_artifacts/import_share_contract_test.dart
00:00 +0 -4: Some tests failed.
```

The preserved contract now passes: `4 passed`.

## Notes

- GitNexus impact calls for the known Flutter symbols returned `Target '' not found`; no implementation edit followed this tool failure.
- The backend's client-visible request ceiling is the existing Express 1 MiB ceiling; `LiveArtifactStorage` only independently caps state at 512 KiB.
- The blocker is resolved by `AuthSessionService.currentWorkspace!.id`; AuthGate
  guarantees normal content has a workspace. Sandbox status remained healthy
  on API :4098 / engine :4097.
