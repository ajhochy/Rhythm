# Rhythm Agent Tools / OpenDesign scoped plan

Sol planning for the delegated R15 slice. Parent owns current-plan.md, so this dated plan preserves concurrent project memory ownership.

Goal: show the existing OpenDesign web UI inside Rhythm's native view and make Hermes/Bot Crossing/OpenDesign/Dayflow discoverable reusable Agent Tools with optional tab pins, preserving existing navigation and the permanent coordinator.

Constraints: source only in this isolated export; no shared-file edits, live data mutation, permissions, credentials, listener/service startup or plugin removal. Terra CLI exact gpt-5.6-terra implements; Sol reviews. CLI persists in normal home for Bot Crossing. No fallback model or approval bypass. Use existing deps and native view lifecycle/geometry. Attach only to a verified installed service; unavailable is honest and retryable. Existing app/runtime owns projects/settings. Defer plugin removal until integration passes.

Clarification interview: user already explicitly approved catalog + pin-tabs design and preserving tabs; delegation supplies concrete ownership/data/lifecycle requirements. No new clarification needed.

Prior art: exact R15 hermes-view.mjs, colony-view.mjs, pages/hermes/index.tsx and Shell menu/toast geometry; installed Hermes OpenDesign runtime identity/ownership checks. No new dependency or architectural pattern.

| Order | Slice | New owned files | Verification |
| --- | --- | --- | --- |
| 1 | Small immutable tool descriptors + registration map | electron/src/rhythm-agent-tools.mjs + .d.mts; web/src/agentTools/* | Node contracts: IDs/routes/service/artifact/lifecycle/capability/permission metadata, duplicate rejection, no execution authority |
| 2 | Existing OpenDesign service discovery + native view | electron/src/open-design-runtime.mjs, open-design-view.mjs | Bounded paired identities/executable/listener/health checks; hostile frames/origins; suspend/resume; clipped zoom geometry; no service spawn/stop |
| 3 | Native OpenDesign page + catalog/pin UI | web/src/pages/open-design/*; web/src/components/tools/AgentToolsCatalog.tsx + CSS | Fixture Playwright or rendered harness: open, pins, error/retry, existing tabs; actual source UI screenshots before production build |
| 4 | Builder hooks + integration checks | dated hooks doc only, no shared edits | Main/preload/App/Shell/SessionRail/ToolWorkspace/package/security-receipt exact hooks; native combined smoke remains builder-owned |

Registry is static metadata and explicit adapters, not a dynamic plugin loader/marketplace. Per-user tab preference uses the existing user preference scope pattern; defaults preserve old tabs. Dayflow describes existing host contract only. OpenDesign uses no preload/Node privileges in its own guest and grants no new external capability. Native views remain alive across tabs; close only on document revocation/quit/profile reset. Nonmodal menu/toast space uses existing Shell reserves; blocking dialogs alone zero view bounds.

Acceptance: each descriptor has id,label,route,service/artifact,lifecycle,capabilities/permissions; fixed route map and adapter registration rejects unknown/duplicate IDs. Catalog Open invokes existing routes; pin/unpin only changes shortcuts, defaults retain current tabs. OpenDesign attaches to verified exact literal loopback origin, preserves existing data, rejects untrusted IPC/guest authority, survives tab leave/return without reload. Geometry matches existing reserves/zoom clipping. Missing runtime shows retryable fixed safe copy. Shared build hooks are reviewable and have not been applied by this owner. Existing plugin entry/data remain untouched pending proven combined route.
