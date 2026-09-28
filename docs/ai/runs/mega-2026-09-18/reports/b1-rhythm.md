## Summary

Added bundle-level React singleton checks and standalone root scripts. React 18.3.1 passes **235 tests**; typecheck and build pass. **React 19 verification remains blocked** by npm registry DNS failure and incomplete offline cache.

Branch: `mega/ws-b1-rhythm-workspace-ui`; HEAD: `de41b85c`. Changes are uncommitted. Branch/write preflight passed; Node is `v22.23.0`. `tsup` was already available, so no package `npm ci` was needed.

## Files changed

- `package.json` — adds the two requested root scripts; workspaces unchanged.
- `packages/rhythm-workspace-ui/package.json` — builds fresh artifacts before `npm test`.
- `packages/rhythm-workspace-ui/scripts/react19-matrix.mjs` — copies build inputs and builds inside the isolated React 19 fixture before testing.
- `packages/rhythm-workspace-ui/tests/no-second-react.test.ts` — five assertions covering external declarations, ESM/CJS host imports, source-map inputs, and runtime markers.
- `docs/ai/decisions/2026-09-18-rhythm-workspace-ui-standalone-package.md` — records standalone installation and validation boundaries.
- `REPORT.md` — this handoff.

## Checks run

Package commands ran from `packages/rhythm-workspace-ui`.

`npm run typecheck` — **PASS**, exit 0:

```text
> @ajhochy/rhythm-workspace-ui@0.2.0 typecheck
> tsc --noEmit
```

`npm run build` — **PASS**, exit 0; output tail:

```text
DTS ⚡️ Build success in 8344ms
DTS dist/index.d.ts  35.41 KB
DTS dist/index.d.cts 35.41 KB
copied /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-b1-rhythm-workspace-ui/packages/rhythm-workspace-ui/src/styles -> /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-b1-rhythm-workspace-ui/packages/rhythm-workspace-ui/dist/styles
```

`npm test` — **PASS**, exit 0, React/React DOM both `18.3.1`; output tail:

```text
 ✓ tests/no-second-react.test.ts (5 tests) 25ms

 Test Files  20 passed (20)
      Tests  235 passed (235)
   Start at  19:01:59
   Duration  12.16s (transform 3.56s, setup 518ms, collect 18.45s, tests 54.33s, environment 33.48s, prepare 5.58s)
```

`npm run test:react19` — initial install was silent and interrupted, exit 130. Diagnostic retry `npm_config_fetch_retries=0 npm run test:react19` — **FAIL**, exit 1, before build/tests. Relevant output:

```text
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/@types%2fnode failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
Error: Command failed: npm install --no-audit --no-fund
```

`npm_config_offline=true npm_config_fetch_retries=0 npm run test:react19` — **FAIL**, exit 1:

```text
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/@types%2fnode failed: cache mode is 'only-if-cached' but no cached response is available.
```

Additional checks:

- `./node_modules/.bin/vitest run --config vitest.config.ts tests/no-second-react.test.ts` — **PASS**, 5 tests. A temporary `__reactFiber` injection made the same command fail exactly one assertion; the artifact was restored before the final build/suite.
- `npm run workspace-ui:build` from root — **PASS**, exit 0; `DTS ⚡️ Build success in 5729ms`.
- `git diff --check` — **PASS**, exit 0, no output.
- `git diff --exit-code -- package-lock.json packages/rhythm-workspace-ui/package-lock.json docs/ai/contracts/issue-11.json` — **PASS**, exit 0, no output.
- Node assertions confirmed the exact requested root script values and `workspaces: ["apps/api_server"]`.
- `gitnexus impact FIXTURE_ENTRIES --direction upstream --file packages/rhythm-workspace-ui/scripts/react19-matrix.mjs --repo Rhythm` — unavailable analysis: `Target 'FIXTURE_ENTRIES' not found`, risk `UNKNOWN`; registered index is stale.

No sockets, browser runs, Electron launches, commits, or other-worktree edits were performed. Root `workspace-ui:test` was statically checked; its React 19 stage has the same installation blocker.

## Acceptance criteria

- **1 — partial:** inspected both package scripts; neither vendors/syncs `apps/web`. Current package typecheck, build, and React 18 tests pass. React 19 installation blocks the fourth check; no application-source drift repair was required by completed checks.
- **2 — partial:** React 18.3.1 passes; new tests inspect both `dist` formats and reject injected React DOM runtime code. React 19.2.0 remains pinned but unverified.
- **3 — done:** exact root scripts and decision document added; root workspaces and both lockfiles unchanged.
- **4 — done:** no existing test path changed, so `docs/ai/contracts/issue-11.json` is unchanged.

## Decisions

- Build before testing and inside the React 19 fixture; rejected inspecting stale or React-18-only artifacts.
- Preserve the existing React 19.2.0 pin; rejected changing supported-version evidence to work around unavailable downloads.
- Keep all component sources unchanged; no sync/vendor script exists to rerun.
- Record the run here; broader project-state/dashboard writes are outside this worker's explicit scope.

## Follow-ups

- Orchestrator: run `npm run workspace-ui:test` with npm registry access to complete both React hosts, including the new React 19 build step.
- Orchestrator: record the run on the Dev Dashboard; worker scope disallows that external write.
- No adjacent product bugs identified. GitNexus did not provide a current blast-radius result.

## Needs a human

None. The remaining validation can be rerun by the orchestrator with registry access.
