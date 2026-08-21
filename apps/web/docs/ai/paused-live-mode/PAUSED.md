# Paused live-mode work (quarantined 2026-08-12)

The live-server integration run was explicitly canceled. This directory preserves
its partial work as evidence without letting it affect the fixture-only prototype.

## Preserved evidence

- `../contracts/issue-0-live-mode.json` — the live-mode acceptance contract (all criteria `pending`).
- `../../tests/contract/issue-0-live-mode.spec.ts` — the executable live contract. Excluded from
  ordinary Playwright discovery by both configs unless `RHYTHM_LIVE_E2E=1` is set explicitly.
- `vite.config.live.ts.txt` — the canceled loopback live proxy/middleware Vite config, verbatim,
  including its incomplete `stripBrowserHeaders` type signature (it did not compile).

## Removed live wiring

- `package.json` scripts `live:dev` and `test:live` (the latter referenced `tests/live/live-smoke.spec.ts`,
  which was never generated). `test:contract` now runs the whole `tests/contract` directory.
- The live proxy/middleware block in `vite.config.ts`, replaced with the ordinary web config
  (relative production assets, strict ports, no proxies).

## Resuming later

Restore the Vite live block from `vite.config.live.ts.txt`, reintroduce the scripts above,
finish the live adapter (`tests/live/live-smoke.spec.ts` and the in-app live data adapter),
and run the paused contract with `RHYTHM_LIVE_E2E=1`. Note: criterion `issue-0-c8` asserts the
`live:dev`/`test:live` scripts exist, so it stays red until that wiring is restored.
