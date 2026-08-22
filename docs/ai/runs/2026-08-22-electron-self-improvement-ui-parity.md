---
date: 2026-08-22
repo: Rhythm
branch: agent-stack/si-electron-ui-parity
pr: null
issues: []
status: repairing
tags: [run, rhythm, web, electron]
---

## Files

- `apps/web/src/gateway/{org-proposals,run-outcomes,auto-promotion}.ts` and `gateway/index.ts`: local proposal/outcome gateways and cloud auto-promotion gateway.
- `apps/web/src/components/{ToolWorkspace,Inspector}.tsx`: live Review Queue, Inspector run feedback, and Agent Settings auto-promotion controls.
- `apps/web/src/styles.css`: scoped proposal, feedback, and auto-promotion styles.
- `apps/web/tests/gateway/self-improvement-gateways.spec.ts` and `tests/bucket-a-rendered-repair.spec.ts`: gateway and rendered live-contract coverage.

## Exact verified code candidate

`e8a7235e08d5688d22df1c9d2602baf60c59fab3`

All commands below ran from this exact clean code/evidence commit, except the
visual command which produced the evidence committed by that SHA from the same
source tree immediately before the commit. The subsequent exact-SHA build and
Electron launch consumed the same renderer source.

## Exact commands and observed results

### Full React and rendered contracts

Working directory: `apps/web`

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node --version
npm test
```

Observed: Node `v22.23.1`; exit `0`; main Playwright suite `265 passed`,
`4 skipped`, `0 failed` in 5.5 minutes; rendered repair suite `12 passed`,
`0 failed` in 13.6 seconds. The rendered suite includes seven self-improvement
contracts: real `sandbox-vetted`/`pending` tool decisions, closed conditional
confirmation, applied history, mutation errors, feedback session races and
failed destination loads, default-off promotion, 403, and 409 states.

The lifecycle counterexample was first proved RED with:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx playwright test -c tests/bucket-a-rendered-repair-playwright.config.ts \
  --grep 'self-improvement-review-live' --workers=1
```

Observed before repair: exit `1`; `proposal-reject-tool-1` was absent for a
real `sandbox-vetted` tool. Observed after repair: exit `0`; the complete
self-improvement subset was `7 passed` in 5.6 seconds.

### Production build, dist smoke, and Electron shell

Working directory: `apps/web`

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node --version
npm run build
npm run test:dist-smoke
npm --prefix ../electron run typecheck
npm --prefix ../electron test
```

Observed: Node `v22.23.1`; exit `0`; Vite transformed `1665` modules and built
`dist/index.html` plus two assets; dist smoke verified the index and both
relative assets; Electron typecheck passed; Electron shell suite `35 passed`,
`3 skipped`, `0 failed` in 2.54 seconds. `slice-5-c3` launched real Electron
and loaded the local Agents route; `slice-5-c5` verified denied navigation,
popups, permissions, and downloads. The launch-generated legacy screenshot was
restored after the test; final `git status --porcelain` was empty.

### Reproducible visual, accessibility, overflow, and action gate

Working directory: `apps/web`. Terminal A:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export VITE_RHYTHM_GATEWAY_MODE=live
export VITE_RHYTHM_API_BASE=http://127.0.0.1:4098
export VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098
export VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097
export VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097
export VITE_RHYTHM_PRODUCTION_API_BASE=http://127.0.0.1:4098
export VITE_RHYTHM_LIVE_TOKEN=visual-gate-disposable
npm run dev -- --host 127.0.0.1 --port 4181
```

Observed: Vite `v5.4.21`, ready in `131 ms`, loopback URL
`http://127.0.0.1:4181/`. Terminal B:

```bash
mkdir -p ../../docs/ai/runs/evidence/self-improvement-ui-parity
RHYTHM_VISUAL_EVIDENCE_DIR="$PWD/../../docs/ai/runs/evidence/self-improvement-ui-parity" \
  node tests/self-improvement-visual-gate.mjs \
  > ../../docs/ai/runs/evidence/self-improvement-ui-parity/results.json
```

Observed: exit `0`; Review Queue and Agent Settings at 100% and 200%-equivalent
viewports each had `0` serious/critical axe violations and `0` pixels of
horizontal overflow; Approve and Enable were reachable after scrolling at
200%; raw `changeJson` sentinel `must-not-render` was absent. The server was
then terminated and port `4181` confirmed closed.

Durable evidence:

- `docs/ai/runs/evidence/self-improvement-ui-parity/results.json`
- `docs/ai/runs/evidence/self-improvement-ui-parity/rhythm-electron-review-100.png`
- `docs/ai/runs/evidence/self-improvement-ui-parity/rhythm-electron-review-200.png`
- `docs/ai/runs/evidence/self-improvement-ui-parity/rhythm-electron-review-200-action.png`
- `docs/ai/runs/evidence/self-improvement-ui-parity/rhythm-electron-settings-100.png`
- `docs/ai/runs/evidence/self-improvement-ui-parity/rhythm-electron-settings-200.png`
- `docs/ai/runs/evidence/self-improvement-ui-parity/rhythm-electron-settings-200-action.png`

Pixel inspection confirmed real `sandbox-vetted` status, Reject/Approve
affordances, closed safety and experiment projections, default-off promotion,
and no clipping, overlap, or unreadable controls.

### Static and repository gates

```bash
cd apps/web
node /Users/ajhochhalter/.agents/skills/impeccable/scripts/detect.mjs --json \
  src/components/ToolWorkspace.tsx src/components/Inspector.tsx src/styles.css
cd ../..
git diff --check
git status --porcelain
```

Observed: design/static detector returned `[]`; diff check exited `0`; status
was empty. The staged security scan reported zero hardcoded-secret, injection,
eval/exec, unsafe-deserialization, SQL-formatting, DOM-XSS, and debug-log
findings.

## Review history

- Staged review found one P1 stale verdict after a failed destination-session
  load. The test reproduced RED; `4297a247` cleared stale verdict state and
  gated controls on an existing outcome.
- Immutable range review of `d257232a..4297a247` found one P1 real tool
  lifecycle mismatch plus one P3 summary-only run record. The P1 reproduced
  RED. `e8a7235e` aligns tool approval with `sandbox-vetted`, tool rejection
  with `sandbox-vetted|pending`, and adds a production-shaped rendered test.
  This exact-command record and durable visual evidence close the P3. A fresh
  immutable review is required after this documentation commit.

## Notes

- No backend, Flutter, Electron main/preload/security/release, package manifest, lockfile, or dependency changes were made.
- GitNexus MCP was unavailable in this worktree session, so impact/detect results are unknown.
