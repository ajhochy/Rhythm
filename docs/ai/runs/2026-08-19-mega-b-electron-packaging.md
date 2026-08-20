---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-b-electron-packaging-pr
pr: null
issues: [1402]
status: verified
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-1402.json`
- Initial failing command: `cd apps/electron && node --test test/issue-1402-packaged-api-server.test.mjs`
  - 0/2 passed after dependencies were installed.
  - c1: `Contents/Resources/api_server/dist/server.js` was absent.
  - c2: resolver returned dev `npx tsx src/server.ts` instead of the staged bundle.
- Final command: `cd apps/electron && node --test test/issue-1402-packaged-api-server.test.mjs`
  - PASS: 2/2, 0 fail, 82.816 s.
- `issue-1402-c2` remains in `not_tested` only for the final clean-machine process-to-Live observation. The automated fixture proves bundled Node/server selection and removes the bundled entry to prove a packaged executable fails closed instead of walking into this checkout.

## Files changed

- `apps/electron/scripts/package-mac.mjs`
- `apps/electron/src/agent-server.mjs`
- `apps/electron/package.json`
- `apps/electron/test/issue-1402-packaged-api-server.test.mjs`
- `docs/ai/contracts/issue-1402.json`
- `docs/ai/runs/2026-08-19-mega-b-electron-packaging.md`

No bucket-A UI, gateway, notification, or `apps/api_server` source/manifest file changed.

## Checks run

- `cd apps/api_server && npm install` — PASS; 218 packages installed; postinstall completed.
- `cd apps/api_server && npm run build` — PASS; TypeScript build and advisory postbuild completed.
- `cd apps/electron && npm install` — PASS; 72 packages installed.
- `cd apps/web && npm install` — PASS; required by the existing `package:mac` web build.
- `cd apps/electron && npm run typecheck` — expected pre-existing failure only: 12 errors in `src/artifact-policy.mjs`; no issue-1402 file appeared.
- `cd apps/electron && npx tsc --allowJs --checkJs --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --types node src/agent-server.mjs scripts/package-mac.mjs test/issue-1402-packaged-api-server.test.mjs` — PASS, no output.
- `cd apps/electron && npm test` — 33/34 pass. The sole failure is existing `slice-7-c4`, which points at `127.0.0.1:4098` and received `ERR_CONNECTION_REFUSED`. It is server-dependent; the dispatch requires a sandbox at 4298/4297 and forbids an independently launched api_server, so it was not made green by changing bucket-A test/runtime ports.
- `cd apps/electron && npm run package:mac` — PASS; produced `dist/Rhythm.app` with an ad-hoc signature.
- `cd apps/electron && node --test --test-name-pattern='issue-1402-c2' test/issue-1402-packaged-api-server.test.mjs` — PASS, 1/1; staged standalone `.app` selected bundled Node + `Resources/api_server/dist/server.js`, then returned null after that entry was removed.
- `cd apps/electron && codesign --verify --deep --strict --verbose=2 dist/Rhythm.app` — PASS: `valid on disk`, `satisfies its Designated Requirement`.
- Bundled ABI probe using `Contents/Resources/node/bin/node` — PASS: `{"node":"v22.23.0","abi":"127","sqlite":1,"nodePty":"function"}`.
- `gitnexus_detect_changes(scope=all)` — LOW risk; 3 indexed changed symbols, 0 affected processes. Compare-to-main also sees the intentionally inherited bucket-A work and remains LOW risk.

## Notes

### Bundled resource tree

```text
Contents/Resources/
├── app/                         # existing Electron source + web bundle
├── api_server/
│   ├── .mcp-roles/             # 17 role resources
│   ├── config_seeds/           # tools include production js-yaml install
│   ├── dist/                    # compiled server.js and runtime output
│   ├── node_modules/            # production dependencies
│   ├── opencode_plugins/
│   ├── resources/
│   ├── scripts/
│   ├── vendor/
│   ├── package.json
│   └── package-lock.json
└── node/bin/node                # packaged Node v22.23.0, ABI 127
```

Native payload evidence includes arm64 `better_sqlite3.node`, `node-pty`'s `pty.node` + `spawn-helper`, and an arm64 packaged Node matching the arm64 Electron executable.

### ABI strategy

The package follows `.github/workflows/desktop_release.yml`: build the API, copy the detached runtime shape, run production `npm install` inside it (whose existing postinstall rebuilds `better-sqlite3 --build-from-source`), then copy the exact `process.execPath` Node binary used for that install. The packaged Node immediately opens an in-memory SQLite database and loads `node-pty`; packaging fails before signing on any ABI/load error. Electron ABI rebuilding is intentionally not used because api_server is a separate Node child, not code loaded into Electron.

All resources are staged before the existing final ad-hoc `codesign --deep`; the real signing/notarization script already discovers extensionless Mach-O files and `.node` addons and signs inside-out before the outer app. No real signing/notarization credentials were used.

### Size and remaining smoke

- Before: 249,896 KiB.
- After: 491,436 KiB.
- Delta: 241,540 KiB (235.88 MiB), comprising api_server 125,600 KiB and packaged Node 114,752 KiB.

The prior standalone process-to-Live target is satisfied by the final gate below. Real signing/notarization still requires the documented Apple credentials; no such credentials were used here.

## Final standalone gate — 2026-08-20

- Rebuilt `apps/api_server` and `dist/Rhythm.app` from `9359b0cc`; ad-hoc `codesign --verify --deep --strict` passed.
- Copied `Rhythm.app` to `/tmp/rhythm-mega-b-standalone`, with temporary HOME, userData, DB, vault, skills, live-artifact storage, disposable Keychain, and gateway `:4993`. The test used package-owned `:4098/:4097`; protected `:4001/:4096` were not touched.
- Process evidence: the app-owned child command was `/private/tmp/rhythm-mega-b-standalone/Rhythm.app/Contents/Resources/node/bin/node /private/tmp/rhythm-mega-b-standalone/Rhythm.app/Contents/Resources/api_server/dist/server.js --parent-pid=<app-pid>`, cwd `Contents/Resources/api_server`, with no checkout path.
- Live evidence: `/health` returned `status=ok`; `/opencode/health` returned `status=ready` and `bridgeLive=true`; the external packaged smoke emitted `environment.mode=Live` and a real `GET /agent-sessions` status 200 with `fixtureFallback=false`; shutdown released all package-owned listeners.
- Native probe: Node `v22.23.0`, ABI `127`, arm64; in-memory `better-sqlite3` query returned `1`; `node-pty.spawn` was a function. App size: 491,432 KiB; API payload: 125,600 KiB; Node payload: 114,752 KiB.
- Focused issue contract: 2/2 pass. Full Electron suite: 32/34; the two notification tests fail identically on `origin/main` and are outside bucket B. `npm run typecheck` has the same 12 `src/artifact-policy.mjs` errors on `origin/main`; changed-file JS typecheck passed.
- Package scan found no `.env`, DB, auth/credential/key, private-key, known token-prefix, temporary HOME, or checkout-path leakage. `.mcp-roles` is present as expected.
- Real Developer ID signing, notarization, Gatekeeper assessment, and a separate physical clean-Mac launch remain manual release items.
- Orchestrator GitNexus `detect_changes(compare main)` after the gate: LOW risk, three changed symbols, zero affected indexed processes.
