# Hermes B2: Supervise the Hermes sidecar and gate a bundled Mac payload

## Goal

Let Electron supervise an optional local Hermes server with honest lifecycle states and a consent-based install path. Deliver the sidecar first; bundle a Python runtime only after an arm64 packaging spike proves a signable, self-contained payload feasible.

## Plan

- [Hermes Rhythm feature-pack plan](https://github.com/ajhochy/hermes-rhythm-plugin/blob/plan/rhythm-feature-pack/.hermes/plans/2026-08-20-hermes-rhythm-feature-pack.md): §§5, 7, 18–20 security/coexistence constraints.
- [docs/dev-plans/hermes-port-plan.md](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/dev-plans/hermes-port-plan.md): packaging-spike background; this workstream uses `hermes serve` and does not execute the older engine-adapter/default-flip phases.
- #1534 supplies the payload manifest, inventory, offline-start and license pattern.

## Dependencies

- Existing Electron `apps/electron/src/agent-server.mjs` lifecycle/login-shell discovery pattern and packager; an installed Hermes version supporting the documented serve/auth/health contract.
- Phase 1 sidecar supervision is independently deliverable. Phase 2 packaging is blocked on a written Phase 0 go decision; a no-go leaves the sidecar path available.
- B3 consumes this controller's availability/flag contract; B1 can proceed independently.

## Likely files

- Proposed `apps/electron/src/hermes-server.mjs` exporting `HermesServerController`; `apps/electron/src/main.mjs`, `preload.cjs` and existing runtime configuration seams.
- Existing `apps/electron/src/agent-server.mjs` as the reference, without changing OpenCode ownership behavior.
- Proposed install/status UI and co-located CSS under `apps/web/src/`; fixture specs in `apps/web/tests/`.
- Conditional `apps/electron/scripts/package-mac.mjs`, proposed Hermes payload manifest/stager/notices and `apps/electron/test/hermes-*.test.mjs`.
- Phase 0 measurements, signing notes and go/no-go evidence in `docs/ai/runs/`.

## Requirements

- Phase 0: evaluate uv / PyInstaller / shiv for freezing the Hermes Python runtime into a signable macOS arm64 payload; record source/runtime revisions, measured archive/installed sizes, startup results, signing/notarization constraints and a reasoned go/no-go.
- Phase 1: resolve `hermes` through the existing login-shell `which` pattern, validate the resolved executable and spawn `hermes serve --port 9121 --host 127.0.0.1` from Electron main with bounded readiness polling.
- Expose starting/ready/failed plus a useful failure reason, handle missing executable, timeout, early exit and occupied port, and stop only controller-owned processes on quit. Never reclaim an unrelated listener.
- Gate startup and its UI with `RHYTHM_HERMES_ENABLED`, default ON for the smoke build; explicit disable causes no launch/install. This availability flag does not select the default agent engine.
- If Hermes is absent, show an install affordance; run the Hermes bootstrap installer only after explicit consent to the trusted installer source. Report progress/failure/cancel, then re-resolve and health-check; never silently install or accept renderer-supplied shell commands.
- Phase 2, only after Phase 0 go: extend the existing Mac packager with a manifest-validated production payload, writable state under userData, exact runtime/architecture and resource hashes, neutral build inputs, source/license notices and no developer-path fallbacks.
- A bundled payload must start offline without a checkout, system Python/Node, uv, Homebrew or developer tools; no install/download at launch. Preserve local preferences and record size deltas.

## Acceptance criteria

- [ ] **HRM-B2-AC1:** The Phase 0 report compares the freezing options with measured arm64 artifact sizes/startup evidence and signing notes, records go/no-go, and Phase 2 changes exist only for a go result.
- [ ] **HRM-B2-AC2:** On the real Electron runtime, login-shell discovery starts the exact loopback command on port 9121; health success moves starting → ready, while absent Hermes, timeout and crash produce a clear unavailable/failed state.
- [ ] **HRM-B2-AC3:** Quitting stops the owned process tree without leaving a listener; an occupied port fails safely without attaching to or killing an unrelated service, and existing Rhythm API/OpenCode processes remain untouched.
- [ ] **HRM-B2-AC4:** Smoke-build defaults expose Hermes, explicit `RHYTHM_HERMES_ENABLED=0` launches/installs nothing, and OpenCode remains the default engine in both cases.
- [ ] **HRM-B2-AC5:** Missing-Hermes UI runs zero installer commands before consent or after decline/cancel; explicit consent runs only the trusted bootstrap flow, and success/failure is reflected after re-discovery and health polling.
- [ ] **HRM-B2-AC6:** For Phase 0 go, the actual unsigned arm64 `.app` starts its bundled Hermes offline with no checkout or developer/runtime tools on PATH; missing/corrupt resources fail validation or show an honest unavailable state without fallback.
- [ ] **HRM-B2-AC7:** For Phase 0 go, inventory matches every declared resource hash, source revision, Python/runtime version and architecture; license/provenance checks and scans find no credentials, user data, inherited Vite secrets or developer paths, and packaging leaves preferences unchanged with recorded archive/installed-size deltas.
- [ ] **HRM-B2-AC8:** For Phase 0 no-go, the report explicitly marks AC6–AC7 not applicable, ships no bundled payload, and supplies passing sidecar evidence without claiming a self-contained or signed release.

## Required tests / evaluation

- Add socket-free `node:test` controller/installer/manifest tests under `apps/electron/test/`, covering lifecycle transitions, ownership, flag parsing, consent and manifest corruption; run Electron typecheck/build commands where available.
- Add fixture-mode rendered status/install/disabled-state tests under `apps/web/tests/`; denied consent must result in zero privileged actions.
- Have the runtime-capable orchestrator run real Electron start/health/quit and occupied-port tests; unit stubs alone do not prove supervision.
- If go, test the staged unsigned `.app` on arm64 for offline/no-PATH/no-checkout/missing-resource behavior and preserve exact commands/inventories. Signing/notarization requires separate release evidence.

## Safety and scope

No renderer-held credentials; no second agent runtime bound to `localhost:4001`; no arbitrary proxy to the Rhythm API; OpenCode remains the default engine. Bind Hermes only to `127.0.0.1:9121`, use Hermes's own auth mechanism and retain process ownership boundaries. No silent installation, arbitrary renderer command execution, provider-secret migration, production data writes or takeover/restart of live services. No engine-adapter replacement, Flutter changes, default flip or OpenCode retirement. Work through draft PRs; human signing, merge and release remain separate.
