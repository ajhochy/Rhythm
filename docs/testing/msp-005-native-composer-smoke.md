---
date: 2026-07-30
workstream: MSP-005
platform: iOS
status: pending-native-verification
---

# MSP-005 native expanding composer repro and smoke

## Source-level failing-seam analysis

The failing seam is the timing of `scrollEnabled`, not React Native Paper's
`TextInput` wrapper.

The pre-fix composer controls its height from the native
`onContentSizeChange` event, clamps that height to 132 points, and enables
scrolling only after React has committed the capped height:

```tsx
scrollEnabled={inputHeight >= maxInputHeight}
```

That sequence is observably different on iOS and web:

- On web, Playwright drives a browser `<textarea>`. CSS overflow and browser
  selection scrolling keep the end of a pasted value visible, so the prior web
  test could pass without exercising UIKit.
- On iOS, multiline React Native `TextInput` is backed by a scrollable native
  text view. A paste can emit its larger content size while scrolling is still
  disabled. React then clamps the controlled height and enables scrolling in a
  later render, after the native view already handled the selection change.
  There may be no later content or selection event to scroll the caret into
  view, leaving the newest lines and caret below the visible viewport.
- Keeping native scrolling enabled from the first render does not prevent
  controlled growth: `onContentSizeChange` still drives 24 → content height →
  132. Before the content exceeds 132 there is nothing to scroll; after it
  exceeds 132, the already-active native scroll view can keep the selection
  visible.

Clearing the controlled `draft` has a second native-event seam. The old code
only shrinks after another `onContentSizeChange`. A programmatic clear can
therefore retain the last measured height when iOS does not deliver another
content-size event. The fix explicitly resets an empty draft to 24 points while
still using content-size events for ordinary line-by-line deletion.

### Proof against replacing the Paper wrapper

Rhythm uses `react-native-paper` 5.15.x. Its `TextInputFlat` implementation:

1. removes the numeric `height` from the outer view style,
2. applies that height as the multiline native input height and wrapper
   `minHeight`, and
3. forwards the remaining native props, including `onContentSizeChange` and
   `scrollEnabled`, to its rendered React Native `TextInput`.

The component test renders the real Paper input and dispatches
`contentSizeChange` through that wrapper; the composer receives it and grows to
the measured height/cap. The wrapper is therefore neither swallowing the event
nor blocking the controlled height. Replacing Paper would broaden the
MSP-005/MSP-002 merge surface without addressing the late scroll-enable
transition, so the Paper wrapper remains.

### Keyboard-avoiding and control reachability

`ChatView` renders `ChatContent` and `ChatComposer` as siblings inside the same
iOS `KeyboardAvoidingView` (`behavior="padding"`, offset 0). The send and
attachment buttons are siblings of the capped text input, not descendants of
its scroll viewport. Capping the input at 132 prevents a long draft from
growing the composer without bound, while the avoiding view raises the entire
composer above the keyboard. No keyboard layout restructuring is needed; the
native checklist below remains the authority for keyboard transitions,
rotation, and compact widths.

## Minimal pre-fix reproduction

Use a signed development build on a physical iPhone for acceptance evidence. A
simulator run is useful for iteration but does not replace the physical result.

1. Open an agent chat and focus the empty `Ask anything...` composer.
2. Paste 15–20 newline-separated lines in one paste so the content crosses the
   cap in a single native event.
3. Without typing another character, inspect the visible text and caret.
4. Drag inside the input, then type one character at the end.
5. Delete back to two lines, then clear the draft completely.

Expected:

- The input grows from 24 points to a maximum of 132 points (six 22-point
  lines).
- The pasted tail and caret are visible immediately; content beyond 132 points
  scrolls inside the input.
- Send and attachment controls remain visible and tappable above the keyboard.
- Deleting lines shrinks the input, and clearing returns it to 24 points.

Reported pre-fix physical-iOS actual:

- The input reaches its cap, but a single long paste can leave the viewport on
  earlier lines with the newest text/caret hidden.
- The old source-level and Playwright checks pass because they never execute the
  native UIKit scroll transition.

## Signed native smoke matrix

Record the device, iOS version, signed build identifier, commit SHA, tester,
timestamp, and evidence path before checking any result.

- Device:
- iOS version:
- Signed build/profile:
- Commit SHA:
- Tester/signature:
- Timestamp:
- Screenshot or screen-recording path:

### Core growth and caret

- [ ] Type one line: input is 24 points and controls remain aligned.
- [ ] Type lines 2–6: input grows one line at a time without covering text.
- [ ] Type beyond line 6: height remains 132 points and the input scrolls.
- [ ] Paste 15–20 lines at once: the final line and caret are immediately
      visible without an extra keystroke.
- [ ] Move the caret into the middle, edit, then return to the end: the active
      caret remains visible.
- [ ] Delete from over-cap to two lines: the input shrinks with the content.
- [ ] Clear via Select All/Delete and after sending: height resets to 24 points.

### Required native matrix

- [ ] Paste: short, exactly-at-cap, and well-over-cap drafts behave correctly.
- [ ] Rotation: portrait → landscape → portrait preserves draft, cap, scroll
      position, and reachable controls.
- [ ] Keyboard transitions: show, interactive dismiss, hide/show, hardware
      keyboard connect/disconnect, and app background/foreground preserve the
      draft and composer position.
- [ ] Dynamic Type: test default, one larger accessibility size, and the
      largest supported size; text/caret are visible and controls do not overlap.
- [ ] VoiceOver: input, dismiss, attach, and send controls have usable focus
      order and labels; editing announces the insertion point.
- [ ] Attachments: add/remove attachments with an empty, short, and over-cap
      draft; attachment and send controls stay reachable.
- [ ] Compact widths: smallest supported iPhone portrait and landscape keep
      send/attachment controls on-screen and tappable.

### Result

- [ ] PASS — all checks above have signed physical-iPhone evidence.
- [ ] FAIL — capture the failing step, exact observed behavior, and evidence.

Physical-device evidence is pending and must be supplied by the orchestrator;
this implementation run cannot launch/install the app or sign that evidence.
