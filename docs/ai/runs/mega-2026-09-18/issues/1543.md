# Hermes B4: Theme the Hermes dashboard to match Rhythm in both hosts

## Goal

Make the Hermes dashboard feel native to Rhythm while preserving a generic dashboard theme seam in the fork. `hermes skin` styles the TUI, so it does not implement this web UI work; ship the Rhythm theme in the feature pack and apply the same tokens to B3's Electron view.

## Plan

- [Hermes Rhythm feature-pack plan](https://github.com/ajhochy/hermes-rhythm-plugin/blob/plan/rhythm-feature-pack/.hermes/plans/2026-08-20-hermes-rhythm-feature-pack.md): §§5, 7, 18–20; Rhythm-specific code stays in the feature pack and responsive/keyboard/theme/WCAG gates remain required.
- [docs/dev-plans/hermes-port-plan.md](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/dev-plans/hermes-port-plan.md): coexistence context only; no default-engine change.

## Dependencies

- B1's unified feature-pack/theme resource delivery and B3's isolated dashboard view with a validated document lifecycle.
- Existing Rhythm tokens in `apps/web/src/styles.css`; verify the fork dashboard's actual style entry points during implementation. Generic core seam must work without the Rhythm plugin installed.

## Likely files

- Fork dashboard web UI theme entry points (confirm paths before edits): generic theme registration/loading and semantic token mapping only.
- Fork `plugins/rhythm/` theme CSS/assets and desktop/dashboard packaging/disposal seams; tests under `tests/plugins/rhythm/`.
- B3's proposed `apps/electron/src/hermes-view.mjs` and theme resource/insertion lifecycle; `apps/electron/test/hermes-theme.test.mjs`.
- `apps/web/src/pages/hermes/` co-located CSS; rendered/accessibility specs under `apps/web/tests/`. Read existing `apps/web/src/styles.css` tokens instead of appending a large global block.

## Requirements

- Add a generic, opt-in dashboard web theme seam with sensible unthemed fallback; core must contain no Rhythm-specific selectors, colors, imports or product behavior.
- Package the Rhythm theme with the feature pack. Use one canonical token definition to produce both the plugin theme and Electron CSS, avoiding independently drifting palettes.
- Map primary `#4F6AF5`, sidebar `#F8F9FA`, borders `#E5E7EB`, text `#111827` / `#6B7280` / `#9CA3AF`, error `#EF4444` and success `#10B981` into semantic light tokens. Supply explicit accessible dark counterparts and foreground/background pairings; do not rely on color alone for state.
- Apply the same theme to B3 with `webContents.insertCSS` only on its validated dashboard document. Track/remove insertion keys and reapply once on reload/theme change; teardown/disable restores the baseline without style accumulation or affecting other contents.
- Cover dashboard navigation, chat/session surfaces, forms, loading/empty/error/disabled states, scrollbars and visible keyboard focus using Rhythm spacing/type patterns as well as colors.
- Preserve accessibility at three recorded supported window sizes, in light and dark and at 100%/200% zoom. Keep primary hit targets at least 44×44 CSS px, scroll regions focusable or containing focusable content, valid ARIA and no nested interactive controls; support RTL.

## Acceptance criteria

- [ ] **HRM-B4-AC1:** A generic theme registers and disposes through the fork's dashboard seam; removing the Rhythm feature pack restores the default dashboard with no Rhythm-specific core dependency, and no `hermes skin` change is needed.
- [ ] **HRM-B4-AC2:** Computed styles in the feature-pack dashboard and Electron tab match the canonical light tokens listed above and the documented dark mapping, including error/success states with accessible foregrounds and non-color indicators.
- [ ] **HRM-B4-AC3:** Repeated reloads, light/dark changes and enable/disable cycles produce one current theme per live document with no stale insertion keys or duplicate styles; unrelated Hermes/Rhythm surfaces retain their original styles.
- [ ] **HRM-B4-AC4:** Both hosts pass a recorded matrix of three supported window sizes (minimum, typical and wide; exact dimensions in the test fixtures) × light/dark × 100%/200% zoom; screenshots show readable, unclipped navigation, content, forms and status states with no lost actions.
- [ ] **HRM-B4-AC5:** Every matrix case is axe clean for WCAG 2.1 AA, including contrast and `scrollable-region-focusable`, `nested-interactive`, `aria-prohibited-attr` checks; keyboard traversal/focus, 44×44 primary targets, accessible names at zoom and RTL layout also pass explicit rendered assertions.
- [ ] **HRM-B4-AC6:** Theme assets are present in the unified package and Electron payload, work offline, and missing theme resources yield the usable baseline; package inventory/provenance covers those assets and scans find no credentials or user data.

## Required tests / evaluation

- Add fork theme-contract/load/disposal tests under `tests/plugins/rhythm/` and socket-free Electron insertion/document-lifetime tests under `apps/electron/test/`.
- Add `apps/web/tests/` fixture-mode specs for semantic tokens, light/dark, zoom, RTL and accessibility; theme tests must assert computed styles instead of class presence alone.
- Have the orchestrator capture screenshots and axe reports for the full matrix in both real hosts, including actual Electron `insertCSS`; review clipping, focus order and error/success distinguishability beyond axe's automated coverage.
- Exercise theme disposal, missing resources and offline packaged assets; record dimensions, zoom, runtime versions, commands and screenshot/report paths.

## Safety and scope

No renderer-held credentials; no second agent runtime bound to `localhost:4001`; no arbitrary proxy to the Rhythm API; OpenCode remains the default engine. Styling never changes auth, approval, network or bridge policy. Keep the core seam generic and Rhythm branding in the feature pack; inject only into B3's validated dashboard document, never arbitrary pages. No production writes, auto-sent chats, TUI reskin, runtime replacement or host retirement. Use existing tokens and co-located CSS; human merge/release remains separate.
