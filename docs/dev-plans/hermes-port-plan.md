# Hermes-over-OpenCode — Build Plan

> Companion to `docs/engineering/hermes-port-architecture.md`.
> Strategy: **Option A** — run Hermes as a sidecar runtime behind an
> `AgentEngine` interface, gated by `RHYTHM_AGENT_ENGINE=hermes`, with the
> existing OpenCode path as the default fallback. Every phase is shippable and
> reversible. Production data (`api.vcrcapps.com`) is never touched.

## Guiding constraints

- Branch + PR per phase; never merge without the user's local-test sign-off
  (CLAUDE.md Git/PR workflow).
- The OpenCode engine stays the default until Phase 6 flips it. Nothing is
  deleted until Phase 7.
- `dart format .` + `flutter analyze --no-fatal-infos` before any Flutter PR;
  `npm run build` (tsc) clean before any api_server PR.
- Each phase logs a run note to `docs/ai/runs/` and updates
  `docs/ai/project-state.md`.

---

## Phase 0 — Spike: can Hermes run as a sidecar and stream a turn? (1–2 sessions)

**Goal:** de-risk the two unknowns — packaging and event translation — before
writing any adapter.

1. Install Hermes locally; run `hermes dashboard` and capture the real REST +
   `/api/ws` traffic for: create session, send prompt, stream tokens, tool call,
   idle, abort. Save transcripts to `docs/ai/runs/` as the translation spec.
2. Write a throwaway Node script that opens `/api/ws`, sends one prompt, and logs
   every frame. Confirm we can map frames → the OpenCode event shapes in
   `@types/opencode-ai-sdk.d.ts` (`message.part.delta`, `session.idle`, …).
3. Spike the packaging question: can `hermes` be frozen (PyInstaller / `uv` /
   shiv) into a single signable binary for arm64 macOS? Note size + signing.

**Exit criteria:** a documented frame-mapping table + a go/no-go on macOS
packaging. If packaging is infeasible, stop and reconsider Option B.

---

## Phase 1 — Extract the `AgentEngine` interface (1 session, no behavior change)

1. Create `services/agent_engine.ts` defining the interface (the ~20 methods the
   controllers + `opencode_stream_bridge.ts` actually call — audit call sites
   with GitNexus / search, not all 60).
2. Make `OpencodeClientService implements AgentEngine` (compile-only change;
   add no logic).
3. Replace direct `opencodeClient` imports with an `agentEngine` accessor that
   still returns the OpenCode impl. Keep `opencodeSessionMap`.
4. Tests: existing agent WS/e2e suites must pass unchanged.

**Exit:** green build, identical behavior, seam in place.

---

## Phase 2 — `HermesEngineService` skeleton + lifecycle (2–3 sessions)

1. New `services/hermes_engine_service.ts implements AgentEngine`.
2. Implement lifecycle only: spawn/attach `hermes dashboard` (borrow the
   spawn/health/port-autodetect pattern from Hermes' own
   `apps/desktop/electron/main.cjs` and from `lovesmile/.../connection_manager.dart`),
   `initialize`, `ensureReady`, `isReady`, `statusMessage`.
3. Wire `RHYTHM_AGENT_ENGINE=hermes` to select it. With the flag on, the server
   boots, Hermes comes up, capabilities endpoint reports Hermes availability.
4. Everything else throws `NotImplemented` for now.

**Exit:** `RHYTHM_AGENT_ENGINE=hermes npm run dev` boots and reaches "ready".

---

## Phase 3 — Single-turn chat (the core loop) (3–4 sessions)

1. Implement `createSession`, `promptAsync`, `subscribeToEvents`,
   `abortSession`, `getSession`, `listMessages`.
2. Implement the **event translator**: Hermes `/api/ws` frames → OpenCode event
   shapes, fed into the existing `opencode_stream_bridge.ts` untouched.
3. Persist `hermesSessionId` into the existing `sdkSessionId` column; reuse
   `opencodeSessionMap` semantics.
4. Manual test from the **real Flutter app** with the flag on: create a session,
   send a prompt, watch tokens stream, stop mid-turn, resume.

**Exit:** a full chat turn works end-to-end through Hermes with **zero Flutter
changes**. This is the proof-of-concept that validates the whole approach.

---

## Phase 4 — Providers, models, permissions, diffs (2–3 sessions)

1. `listAuthedProviders`, `listModels`, `listAgents` backed by Hermes
   `/api/config` + `/api/models`.
2. Decide provider/model strategy (architecture §5.4): start **B-thin** (pass
   per-turn model override from Rhythm's resolver into Hermes).
3. `respondPermission` / permission-mode mapping (Hermes approval flow →
   Rhythm's `permissionMode`).
4. `getSessionDiff` → `session.diff` events for the Changes tab.

**Exit:** model picker, permission prompts, and diffs work on the Hermes engine.

---

## Phase 5 — Profiles + cron (the strategic payoff) (3–5 sessions)

1. Map a Rhythm domain/project → a Hermes profile (`HERMES_HOME`) via
   `/api/profiles/*`. Surface profile selection in the agent UI.
2. Replace/augment Rhythm's ad-hoc scheduling with Hermes `/api/cron/jobs`
   (create/list/pause/resume/trigger). Decide whether Rhythm's
   `recurrence_generation_job` / `sync_orchestrator_job` defer to Hermes cron or
   stay independent.
3. Surface cron sessions in the session list (Hermes already tags them).

**Exit:** at least one Rhythm domain runs as an isolated Hermes profile with a
working scheduled job. This is the deliverable that justifies the port.

---

## Phase 6 — Packaging, signing, default flip (2–4 sessions, schedule risk)

1. Bundle the frozen Hermes runtime into the macOS app (from Phase 0 outcome).
2. Extend `tools/release/sign_and_notarize_macos.sh` to sign the Python
   framework / embedded binaries; confirm notarization passes.
3. Beta DMG; dogfood. Only after sign-off: change the default so Hermes is the
   engine and OpenCode becomes the fallback (`RHYTHM_AGENT_ENGINE=opencode`).

**Exit:** a notarized DMG where Hermes is the default engine and OpenCode is one
env var away.

---

## Phase 7 — Decommission OpenCode (optional, later)

Only after Hermes has been the default for a stable period. Remove
OpenCode-specific MCP/PTY plumbing, the SDK dependency, and dead resolver routes.
Keep the `AgentEngine` interface.

---

## Effort summary

| Phase | Theme | Sessions | Risk |
|---|---|---:|---|
| 0 | Spike: sidecar + packaging | 1–2 | High (informs go/no-go) |
| 1 | Extract interface | 1 | Low |
| 2 | Hermes lifecycle | 2–3 | Med |
| 3 | Single-turn chat + event xlate | 3–4 | High (core) |
| 4 | Providers/models/perms/diffs | 2–3 | Med |
| 5 | Profiles + cron | 3–5 | Med (the payoff) |
| 6 | Packaging + default flip | 2–4 | High (notarization) |
| 7 | Decommission OpenCode | 2–3 | Low |

**Minimum to a defensible decision:** Phases 0–3 (~7–10 sessions). If Phase 0
packaging is a dead end on macOS, fall back to Option B (Flutter → Hermes
direct) and reuse the `lovesmile/hermes-desktop-ui` Dart client patterns.

## Hard decisions to make before Phase 2

1. **Packaging:** frozen `hermes` binary vs. bundled venv. (Phase 0 answers.)
2. **Session ownership:** does Rhythm own sessions and treat Hermes as compute,
   or does Hermes own sessions and Rhythm mirror them? (Recommend: Rhythm owns
   the local row, Hermes owns the conversation — exactly today's `sdkSessionId`
   split.)
3. **Provider config home:** Rhythm resolver (B-thin) vs. Hermes config (B-fat).
4. **Cron authority:** Hermes cron vs. Rhythm's existing jobs. (Recommend Hermes
   for agent-driven jobs; keep Rhythm jobs for pure-data recurrence.)
