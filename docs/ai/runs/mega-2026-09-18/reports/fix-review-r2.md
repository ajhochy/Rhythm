# Summary

- Fixed #1523's policy blocker. Unsupported per-server MCP values are now classified as advanced instead of inherited, their structured controls are disabled with an explicit warning, and `editMcpGroup` refuses to rewrite them. Exact supported peers remain editable without reserializing untouched advanced policy data.
- Added a realistic advanced MCP fixture covering capability-rule objects, malformed `allowedTools`, scalar future values, unknown keys, lexeme preservation, and a supported sibling edit.
- Fixed #1511 by storing session sort, archived view, and row density in the existing `rhythm.settings.<accountId>` local preference record. Values restore on reload and account changes without adding a server preference or a new storage namespace.
- Fixed #1512 by rendering the Load subagents continuation inside the parent's expanded children container. Collapsing a parent now removes both child rows and the continuation control from the DOM.
- Added an `RHYTHM_LIVE_E2E=1` profile UI contract that creates a marked profile, saves a system-prompt field, reloads the full UI, asserts server readback, and deletes only its own profile in cleanup.

# Files changed

- `apps/web/src/components/profilePolicy.ts` — advanced MCP shape detection and guarded structured edits.
- `apps/web/src/components/profilePolicy.test.mjs` — realistic lossless advanced-policy regression test.
- `apps/web/src/components/Profiles.tsx` — Advanced status, warning, and disabled controls for unsupported MCP groups.
- `apps/web/src/gateway/user-preferences.ts` — validated account-scoped Agents rail preferences.
- `apps/web/src/components/SessionRail.tsx` — preference restore/write wiring and expanded-only child continuation rendering.
- `apps/web/tests/profiles-editor-redesign.spec.ts` — advanced-policy UI preservation plus live-gated save/reload coverage.
- `apps/web/tests/agents-rail-view-options.spec.ts` — reload persistence and two-account isolation coverage.
- `apps/web/tests/agents-rail-child-loading.spec.ts` — collapse/re-expand continuation coverage with no duplicate request.
- `REPORT.md` — this handoff.

# Checks run

- Launch discipline: exact worktree, branch `mega/fix-review-r2`, and write probe passed before edits.
- GitNexus upstream impact: LOW for `mcpGroupSelection`, `CapabilityGroup`, `SessionRail`, and `readLocalUserPreferences`; no affected indexed execution processes. The available index belongs to the integration worktree, so exact local scope was also reviewed with direct caller searches and `git diff`.
- Expected RED: `cd apps/web && node --test src/components/profilePolicy.test.mjs` failed the new advanced-MCP case before implementation (`true !== false`; 11 passed, 1 failed).
- PASS: `cd apps/web && npm run typecheck && npm run build && node --test src/components/profilePolicy.test.mjs` — typecheck/build succeeded and 12/12 unit tests passed. Vite emitted only the existing large-chunk advisory.
- PASS: changed/owned spec compilation with `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx --esModuleInterop --skipLibCheck --types node,@playwright/test tests/profiles-editor-redesign.spec.ts tests/inspector-profiles.spec.ts tests/agents-rail-view-options.spec.ts tests/agents-rail-child-loading.spec.ts`.
- PASS: the same four Playwright specs loaded with `--list` (24 tests in 4 files); this compiles/discovers tests without launching a server.
- PASS: `git diff --check`.
- Not run by instruction: Playwright execution, screenshots, Electron smoke, sandbox startup, and the `RHYTHM_LIVE_E2E=1` profile round-trip. Those require sockets; authored coverage is not reported as runtime evidence.

# Decisions

- Only arrays of strings, empty objects, and exact `{ allowedTools: string[] }` objects are treated as structurally editable. Objects with any additional/unmodeled keys, malformed grants, or scalar future values are advanced and read-only in structured controls.
- `null`, empty arrays, empty objects, and empty `allowedTools` retain the existing backend-compatible inherited behavior. Missing servers in an explicit map remain explicit no-access.
- Existing account-scoped local preferences were extended instead of adding a backend endpoint or independent storage keys; theme and send-key writes continue to merge without erasing rail preferences.
- The continuation control was moved under the same `aria-controls` children container as loaded descendants, making expansion state the single render/activation gate.
- The live profile test uses only a uniquely marked test row and cleanup in `finally`; fixture tests remain unchanged in their network isolation.
- No commit, stash, checkout, socket listener, runtime restart, or remote mutation was performed.
