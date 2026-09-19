## Fork B1 — local install gate (2026-09-18 ~19:40 PDT)
- `bash plugins/rhythm/packaging/install-local.sh` → "Installed validated Rhythm package in ~/.hermes; config/auth unchanged." exit 0 (backups: ~/.hermes/plugins/rhythm.bak-20260918, ~/.hermes/desktop-plugins/rhythm.bak-20260918)
- `hermes plugins doctor rhythm` → OK: runtime discovery, manifest parsing, import, registration; 3 tool(s), 0 hook(s); exit 0
- `hermes plugins enable rhythm` → enabled (tool-override grant declined = stricter option)
- `hermes plugins list` → rhythm enabled 0.1.0
- `hermes doctor` → exit 0
- disable/reload/uninstall half deferred to wrap-up so the install stays live for AJ's smoke
## rhythm-workspace-ui — package gate
- typecheck/build/vitest (235) PASS (worker); `npm run test:react19` PASS: contract suite against isolated React 19.2.0, no duplicate React (orchestrator, gate-b1-rhythm-react19.log)
## apps/mobile — gate on mega 7b3a98be (2026-09-18 ~20:05 PDT)
- `npm run typecheck` PASS; `npm run lint` PASS (0 errors, 3 pre-existing warnings); `npm run contract:check` PASS
- `npm test` (jest): first run under load 95 → 3 suites failed (workspace-search + 2 timing suites); full rerun PASS 32/32 suites, 132/132 tests → flake, not regression
- `node --test tests/contract/issue-1510-working-sound.test.mjs tests/paired-host.test.mjs` PASS 11/11
