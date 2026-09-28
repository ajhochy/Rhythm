# Hermes B3: Embed a supervised Hermes dashboard tab in Rhythm Electron

## Goal

Add a Hermes route and sidebar destination to Rhythm Electron. This deliberately inverts the feature-pack plan's §5 direction: Hermes runs inside Rhythm here, while B1 keeps Rhythm inside Hermes alive. Both directions coexist; neither authorizes replacing OpenCode or retiring either host.

## Plan

- [Hermes Rhythm feature-pack plan](https://github.com/ajhochy/hermes-rhythm-plugin/blob/plan/rhythm-feature-pack/.hermes/plans/2026-08-20-hermes-rhythm-feature-pack.md): §5 direction is explicitly varied above; §§4 and 7 supply bounded, draft-only Rhythm context and secret isolation.
- [docs/dev-plans/hermes-port-plan.md](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/dev-plans/hermes-port-plan.md): sidecar context, without its later default flip.
- #1527 supplies the isolated, document-bound MessageChannel and hostile-frame evaluation pattern.

## Dependencies

- B2's supervised `hermes serve`, authenticated readiness/status contract and shared `RHYTHM_HERMES_ENABLED` flag.
- A verified Hermes-native dashboard auth handoff and the current pinned Electron API. B4 supplies the theme; B1 remains a separate, supported direction.

## Likely files

- `apps/web/src/App.tsx`, `apps/web/src/components/Shell.tsx` and proposed `apps/web/src/pages/hermes/` with co-located imported CSS.
- `apps/electron/src/main.mjs`, `preload.cjs`; proposed `hermes-view.mjs` and `hermes-bridge-policy.mjs`.
- Proposed versioned Hermes intent DTOs in `apps/shared/`; native policy tests in `apps/electron/test/`.
- Fixture-mode route/disabled/rendered specs in `apps/web/tests/` and real pinned-Electron hostile-frame/document-lifetime coverage.

## Requirements

- Add a named Hermes sidebar entry and route behind the same B2 flag. Reflect starting, ready and failed/unavailable states; a disabled direct route must not create a view or privileged action.
- Prefer a `WebContentsView` loading only the local dashboard from B2's supervised server. If unavailable in the pinned runtime, document a sandboxed iframe fallback on a fixed separate custom origin with equivalent isolation tests.
- Keep Node integration off, context isolation on, sandbox on and web security on. Restrict view navigation/popups to the approved dashboard surface; never expose parent DOM, filesystem/process APIs or broad native IPC.
- No Rhythm bearer reaches the view. Use Hermes's own token mechanism through its supported auth handoff, without credential-bearing bridge messages, persistent renderer secret state, URLs or logs.
- Expose only typed/versioned intents for navigating to a Hermes session and opening a new chat draft with bounded Rhythm context. Label free text as untrusted context, preserve entity IDs and never auto-send.
- Use a document-bound MessageChannel per #1527: validate sender webContents/frame, expected origin, document generation, protocol version, method and payload at every privileged boundary. Cap control messages at 64 KiB with explicit field limits; reject oversize payloads without silent truncation.
- Revoke channels on navigation, reload, view destruction, leaving the route and feature disable; each new document gets a fresh channel. Fail closed when supervised Hermes is unavailable.

## Acceptance criteria

- [ ] **HRM-B3-AC1:** With the flag enabled and B2 ready, the Hermes sidebar route renders the real supervised dashboard inside the pinned Electron app; starting/failed states are legible, and navigation back to Rhythm works.
- [ ] **HRM-B3-AC2:** With `RHYTHM_HERMES_ENABLED=0`, no Hermes sidebar entry/view/channel is active; a direct route shows the disabled state and creates zero privileged actions or Hermes launch requests.
- [ ] **HRM-B3-AC3:** Runtime probes confirm Node integration off, context isolation/sandbox/web security on, no Rhythm bearer exposure and no access to parent DOM, filesystem/process APIs, arbitrary URLs or broad native IPC; only the Hermes-native auth handoff succeeds.
- [ ] **HRM-B3-AC4:** Valid typed intents navigate to the requested session or open an editable draft with bounded, labelled Rhythm context; neither sends a message nor creates a legacy Rhythm agent session.
- [ ] **HRM-B3-AC5:** Foreign/sibling frames, an unapproved origin, malformed or oversize messages, unknown methods and unsupported versions each produce zero native/session actions, zero sends and zero state writes.
- [ ] **HRM-B3-AC6:** A stale document/channel after reload, navigation, route exit or disable produces zero actions; the replacement document can act only through its newly validated channel.
- [ ] **HRM-B3-AC7:** Rendered route/status/disabled tests pass, keyboard focus enters and exits the embedded view predictably, and 200% zoom/RTL preserve accessible names and controls without nested interactive elements or inaccessible scroll regions.

## Required tests / evaluation

- Add `apps/web/tests/` fixture-mode specs for route, sidebar, starting/failed and disabled states; fixtures never contain tokens. Assert user-visible results and zero actions for disabled access.
- Add `node:test` validation/lifetime tests under `apps/electron/test/`; include exact 64 KiB boundary, oversize, malformed, foreign-frame and stale-generation cases.
- Run real pinned-Electron view/auth/hostile-frame/message-lifetime tests through the orchestrator; browser-only tests cannot prove native isolation. Test the iframe fallback equivalently if used.
- Falsify sender validation and document-generation rejection independently to prove negative tests fail; record versions, commands and redacted bridge/network evidence.

## Safety and scope

No renderer-held credentials; no second agent runtime bound to `localhost:4001`; no arbitrary proxy to the Rhythm API; OpenCode remains the default engine. The view consumes only B2's supervised loopback service and Hermes-native auth; the bridge carries two typed intents, never secrets or arbitrary commands/paths. No automatic turns, hosted writes, external messages, privilege broadening, live-service takeover or bundled second Electron process. Keep B1 working, use co-located CSS, and leave merge/release and any host cutover to separate human gates.
