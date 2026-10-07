# Make embedded native Dayflow content reachable in short windows

## Goal

Keep the original native Dayflow view usable in Rhythm at normal desktop height. The native viewport must remain clipped to its available window area while the native content retains its own measured height and can scroll within that viewport. Preserve the original native inputs, trusted two-level host ownership, zoom/coordinate mapping, hide/modal behavior, focus ownership, and teardown.

## Acceptance Criteria

1. **Short native viewport.** With a 445-point host viewport and a hosted native view whose intrinsic/fitting height is 558 points, the lifecycle retains a 445-point visible viewport and a separate scrollable document at least as tall as its measured minimum. Scrolling the owned AppKit document to its bottom makes the document’s bottom region visible without enlarging or moving the native host beyond its owning viewport.
2. **Resize and tall viewport.** Resizing from a 944-point viewport to 445 points and back recomputes content dimensions from the current viewport and intrinsic/fitting size; it does not preserve a stale tall frame or truncate the 558-point content. At 944 points, content that fits needs no unnecessary scroll range. The scroll container remains inside the exact trusted parent and uses the current viewport coordinates and zoom.
3. **Scroll and lifecycle ownership.** Scrolling changes only the attached Dayflow document’s visible region; the owning viewport, sibling views, and unrelated windows remain fixed. Hiding for an inactive tool, modal, or hidden/minimized window prevents native interaction and preserves the scroll position for reactivation. Detach/teardown removes only the owned scroll/document views, drops stale bounds/input, and does not steal focus from another window or responder.
4. **Actual native interaction (manual).** In the signed app with the original Dayflow view at 1280×800 and no outer Rhythm Dayflow header or footer, the native view fills the available tab height. Then shrink the window to a short native viewport below the measured 558-point document minimum (target window size 1280×560, recording actual viewport/document dimensions); a native trackpad or mouse-wheel check through CUA reaches the bottom timeline controls and scrolling back restores the top. At 3440×1300, the full content remains visible without unnecessary scrolling. Record CUA/native-input evidence separately from physical-human evidence. This must be checked against the actual native view; a browser facade, synthetic DOM wheel, AppKit `scrollToPoint` fixture, or source-string check does not satisfy this criterion.

## Observed failure and evidence

On frozen C7 source `aaf933e8914a8bee5ab3933c8e73735b6dcd52e3`, the signed normal-profile app at 1280×800 showed the native pane at x=35..1245, y=229..674 (445 points); native Dayflow content was clipped at the top/bottom, including Next/Back and the progress circle during the earlier permission page. Two pages of wheel input inside the pane produced no pixel or accessibility-tree movement. The root later observed the current timeline in that same normal-size failure and confirmed the tall 3440×1300 viewport (944 points) showed all timeline content. No setup action, permission change, capture change, or original-data write was performed for this observation.

The 16/16 browser Dayflow tests, focused bridge tests, and full C7 gate were green. Those tests use a renderer facade and correctly leave native scrolling unverified; they do not prove the original AppKit view is reachable. Keep this failure separate from the green browser evidence.

## Likely files

- `apps/electron/native/dayflow-host/NativeDayflowOwnedHostLifecycle.h`
- `apps/electron/native/dayflow-host/NativeDayflowOwnedHostLifecycle.mm`
- `apps/electron/native/dayflow-host/NativeDayflowProductionBridge.mm`
- `apps/electron/test/native-dayflow-viewport-contract.mm`
- `apps/electron/test/native-dayflow-viewport-contract.test.mjs`

## Tests and evaluation

- Run the native AppKit lifecycle contract on macOS with `RHYTHM_NATIVE_DAYFLOW_CONTRACT=1 node --test apps/electron/test/native-dayflow-viewport-contract.test.mjs`. It compiles the reviewed lifecycle source into a temporary, hidden-window test process, measures real AppKit viewport/document frames, exercises AppKit scrolling and lifecycle ownership, and cleans up only its own temporary artifacts. Before implementation, run once with the explicit frozen-baseline source override; assertion failures are the expected RED, while compiler/setup errors are not.
- The native AppKit geometry contract does not synthesize a wheel event or claim physical input. Before completion, repeat the actual signed-app CUA test in the normal profile at 1280×800 without the outer Dayflow header/footer, at a deliberately short window (target 1280×560, recording actual viewport/document dimensions), and at 3440×1300. Record viewport/document geometry and observable top/bottom content reachability; preserve screenshots or UI-state receipts only through the existing authorized capture path.
- Preserve the existing native lifecycle negative tests, bridge export/function counts, and browser tests. Do not run database suites as part of this isolated native contract.

## Out of scope and safety

- Do not change the selected Dayflow app, its capture/provider/privacy/setup settings, permissions, or original data.
- Do not expand the native view outside the owning window bounds, route real events to an unrelated window, synthesize OS-wide input, or replace native content with a browser/HTML imitation.
- Do not start Rhythm, API, or Electron processes for the isolated AppKit contract. Do not alter the installed signed app during this work.
- Keep the existing 15-function C ABI and 17-export JavaScript surface unchanged; no new renderer authority or generic native input bridge.

## Dependencies

- The frozen native lifecycle source and provenance in the accepted Dayflow host source manifest.
- The C7 browser height/layout implementation and existing native ownership/hide/modal/detach/focus lifecycle.
- Root-owned signed-app CUA validation after the native candidate is rebuilt; this issue does not claim physical-wheel acceptance before that check.
