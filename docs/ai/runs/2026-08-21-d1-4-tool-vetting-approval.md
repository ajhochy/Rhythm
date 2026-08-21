---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1429]
status: blocked-on-managed-installer
tags: [run, rhythm, d1, tool-vetting]
---

# D1.4 tool vetting approval gate — lifecycle repair

## REPAIRED 2026-08-21

Commit `68053e22` was rejected because it vetted only during approval, did not
persist unavailable outcomes, did not auto-reject unsafe outcomes, used the
generic no-op applier, and its live test manually inserted both proposal and
safe report. This repair adds the server-side creation lifecycle and a narrow
authenticated `POST /agent-org-proposals/tool-install` entry point.

State transitions proven:

```
proposed -> sandbox-running -> sandbox-vetted -> approved -> applied       (injected test installer)
proposed -> sandbox-running -> sandbox-vetted -> approved -> failed        (production boundary unavailable)
proposed -> sandbox-running -> rejected                                    (unsafe report persisted first)
proposed -> sandbox-running -> pending -> rejected                         (unknown/unavailable then human denial)
```

The report is persisted and re-read before the second transition. The
`sandbox-vetted -> approved` transition is revision-CAS before the installer
boundary, so a second concurrent approval cannot invoke it.

## Files

- `apps/api_server/src/services/tool_install_proposal_lifecycle.ts` — creation/vet/decision lifecycle.
- `apps/api_server/src/services/tool_install_apply.ts` — explicit fail-closed installer boundary.
- `apps/api_server/src/controllers/org_proposals_controller.ts` and route — authenticated creation plus dedicated approval/denial handling.
- D1.4 lifecycle, route, and live tests; proposal state-machine documentation; issue contract.

## Checks

- RED: `npx vitest run src/services/__tests__/tool_install_proposal_lifecycle.test.ts` failed with `Cannot find module '../tool_install_proposal_lifecycle'` before production lifecycle code existed.
- D1.1-D1.4 + adjacent repository/state-machine/route/apply/schema matrix: 344 passed, 1 env-gated live test skipped. Real-Docker vetter subset: 59/59.
- Node 22: `npx tsc --noEmit` and `npm run build` passed; `runMigrations()` replayed twice against a fresh SQLite DB; `skill_schema_parity.test.ts` passed.
- Live: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 ... npx vitest run src/__tests__/d1_tool_install_approval_live_e2e.test.ts --no-file-parallelism --reporter=verbose` passed 1/1 in 11.46s. It used sandbox `/private/tmp/rhythm-d1-1429-repair`, API/engine/gateway 4098/4097/4099, a real safe Docker vet (in-image `abbrev` package) and a real broken candidate; no live test manually inserted a proposal or report.
- Exact sandbox `down` removed the directory, released all three ports, and `docker ps -a --filter 'name=^/rhythm-d1-vet-'` was empty.
- `git diff --check` passed. GitNexus remains UNKNOWN; no reindex was run.

## Residual blocker

- There is no existing managed installer API for arbitrary npm/pip packages.
  `tool_install_apply.ts` therefore returns the fixed
  `tool_install_apply_unavailable` result in production and the proposal ends
  `failed`, never `applied`. The injected no-op installer is test-only proof
  of ordering and one-winner CAS; it does not claim an actual host install.
  The issue remains blocked on a separately approved managed installer.
