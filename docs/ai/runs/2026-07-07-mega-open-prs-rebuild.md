---
date: 2026-07-07
repo: rhythm
branch: codex/mega-open-prs-2026-07-07
pr:
issues: []
status: draft-pr-ready
tags: [run, rhythm]
---

# Mega Open PR Rebuild

## Files

- Merged open PR heads into `codex/mega-open-prs-2026-07-07` from a clean `origin/main` worktree:
  - PR #932 `fix/agent-scope-clear-and-degraded-ui`
  - PR #937 `fix/org-optimizer-workflow-signals`
  - PR #938 `issue-922-mcp-401-degraded-surfacing`
  - PR #939 `codex/fix-delegated-agent-retry`
  - PR #940 `issue-930-model-fallback-chain`
  - PR #941 `issue-929-skill-self-regulation-wt`
- Regenerated `apps/api_server/package-lock.json` after the merged API dependencies changed.
- Formatted `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`.

## Checks

- `cd apps/opencode_fork/packages/opencode && bun install && bun run build --single` -> pass.
- `apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode --version` -> `0.0.0-codex/mega-open-prs-2026-07-07-202607071856`.
- `cd apps/api_server && npm install --workspaces=false && npm run build` -> pass.
- `cd apps/desktop_flutter && flutter pub get` -> pass.
- `cd apps/desktop_flutter && dart format --output=none --set-exit-if-changed .` -> pass after formatting one merged file.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` -> pass; existing info-level analyzer findings remain.
- `cd apps/desktop_flutter && flutter test` -> pass.
- `cd apps/desktop_flutter && flutter build macos --debug --config-only --dart-define=GOOGLE_DESKTOP_CLIENT_ID="${GOOGLE_DESKTOP_CLIENT_ID:-}"` -> pass.
- `cd apps/desktop_flutter/macos && pod install` -> pass with existing CocoaPods configuration warnings.
- `cd apps/desktop_flutter/macos && xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build` -> pass.

## Notes

- GitHub marked PR #941 checks as `UNSTABLE` before aggregation; it merged cleanly locally.
- `npm install` reported 9 audit findings in the API workspace; no automatic audit fix was run.
- The opencode single-binary build emitted Vite chunk-size warnings but completed successfully.
