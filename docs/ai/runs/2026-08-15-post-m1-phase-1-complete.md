---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: pass
tags: [run, Rhythm, post-m1, phase-1, complete]
---

# Phase 1 COMPLETE — desktop entry and host trust

15 pass · 0 red · 2 pending (manual, assigned to AJ) · 2 not_tested (surface does not exist yet).
Closing gate green, 11/11 components. Nothing committed.

```text
web:typecheck · web:build · web:fixture 14 · web:suite 254 · dist-smoke
web:gateway-sessions 4 · web:live-lifecycle 1 (184.0s)
electron:shell 5 · electron:packaged 6 · electron:phase1-host 3 · parity
parity behaviors 17 · reviewRequired 708 · mappings 10930 · flutter_sha 9fa2761e
residue all zero · protectedPorts contacted []
```

## What closed

| Criterion | Evidence |
|---|---|
| c1a, c1c | fixture cold-launch readiness, already satisfied by M1 |
| c1b | live API+engine readiness against the real sandbox |
| c2a, c2c, c2d | shared `Menu` restores focus to its own trigger; keyboard reaches every destination |
| c2b | retained M1 `responsive-a11y.spec.ts` |
| c3a, c3b | theme and session-setting edits survive renderer reload |
| c3c, c3d | update/provider failures bounded, actionable, redacted |
| c4a | retained M1 shell and package contracts |
| c4b, c4c | deep-link fail-closed policy; single-instance lock routing through one funnel |
| c4e | packaged two-launch proof, mutation-proved |

## Three findings that mattered more than the code

**1. Two criteria were never red.** `c3c`/`c3d` drove `?state=update-error` and `?state=provider-error`,
states `ToolWorkspace.tsx:9` does not define. Re-pointed at the real vocabulary (`unavailable`,
`server-error`) and asserted a live region rather than pinning `role="alert"` — `unavailable` is
legitimately a status. Every other constraint kept. Both passed immediately: the app already had
bounded, actionable, redacted failure states. A red that only proves the test named something
nonexistent is the Slice 4 `role='assistant'` trap wearing new clothes.

**2. Three tests were racing the product, not testing it.** After Unit E implemented the shared `Menu`
focus restore, `c2a` — which had been passing — went red. The failure snapshot showed the menu closed
and the URL unchanged. Cause: an ARIA menu moves focus to its first item one frame after opening, and
the tests called `.focus()` on their target item before that settled. The component's focus won, Enter
activated the FIRST destination, and the URL silently did not change. `c2c` additionally asserted
`theme-toggle` receives focus on open when the account menu's first item is `account-profiles`.
The product behaviour was correct in all three; the tests now wait for the menu to settle, then drive
it. 8/8 twice, and the 16 pre-existing shell/responsive/navigation tests still pass.

**3. `slice-7-c6` caught a real regression the implementing unit introduced.** Acquiring the
single-instance lock before redirecting userData makes Electron materialize the default
`~/Library/Application Support/rhythm-electron-shell` path. Fixed by ordering the redirect first and
registering the smoke-dir cleanup before the lock check, so an instance that yields still reaps what
it created.

## Deliberately not built

- **`c4d` owned-child registry** — `main.mjs` spawns no child processes, so the registry would guard an
  empty set, and its test is a source-text regex that a variable name satisfies. `not_tested`;
  re-opens when the host takes over spawning the local API/engine as Flutter's `ApiServerService` does.
- **`c4b-dialog`** — the host never calls `dialog.*`. `not_tested`; re-opens on the first such call.
- **OS-level URL-handler registration** (`setAsDefaultProtocolClient`, `CFBundleURLTypes`) — would
  change the packaged bundle and risk the Slice 7 byte-manifest assertions. Until it lands, only
  CLI/argv-delivered URLs exercise the deep-link funnel.

## Manual checks assigned to AJ

- **`c2e`** — launch `apps/electron/dist/Rhythm.app`; without touching the trackpad, Tab through the
  header and confirm every destination is reachable with a visible focus ring, that the account and
  More menus move focus to their first item on open and return it to the trigger on close; then enable
  VoiceOver (Cmd+F5) and confirm each destination announces its name and current-page state.
- **`c3e`** — launch the packaged app, change the theme and rename a session, quit fully with Cmd+Q
  (not window close), relaunch, confirm both survive.

Neither was automated because doing so honestly is not possible: VoiceOver cannot be scripted, and the
packaged smoke harness deliberately does not drive the renderer UI.

## Provenance

`src/components/Shell.tsx` and `src/store.tsx` are manifest-covered and changed. Reconciled: 144
entries, verifies 144/144, chain extended in `apps/web/PROVENANCE.md`, root
`0b2d3b22d0b9f75ea5b4c0a6962a24751637adf789f3d51b8944c07e418541a4` →
`361ccc2895a8effd31b51222ec4d7ecf5611ecd9a6e76f0463b41573659a870d`.

## Gate change

`electron:phase1-host` added to `verify-all.mjs` (host-policy + packaged single-instance, 3 tests).
Slice 8's contract treats `REQUIRED_COMPONENTS` as a minimum and requires every component to pass, so
Phase 1 evidence is protected without editing an M1 contract to accommodate it.

## Next

Phase 2 — profile identity and ownership. Its inventory is built
(`docs/ai/coverage/react-electron/phase-2-identity-ownership-inventory.md`) and its RED tests are in
flight. Scope decision recorded there: **there is no profile ownership model** (`agent_configs` has no
`owner_user_id`/`workspace_id`/`project_id`; every authenticated caller sees the same global rows), and
Phase 2 asserts that real contract rather than inventing a workspace model the plan forbids building.
