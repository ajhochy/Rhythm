---
date: 2026-07-30
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Enable iOS composer scrolling before the height cap

## Context

The mobile composer already measured Paper's native text input and capped it,
but it enabled scrolling only after the measured height reached the cap.
Physical iOS reports showed that a large paste could hide the newest text and
caret even though source regex and web textarea tests passed.

## Decision

Retain React Native Paper's `TextInput`. On iOS, keep its underlying native
scroll view enabled from the first render while continuing to drive the visible
height from `onContentSizeChange` between 24 and 132 points. Reset the measured
height to 24 when the controlled draft becomes empty. Preserve the existing
at-cap scroll transition on Android and web.

## Alternatives considered

- Replace Paper with React Native `TextInput`: rejected because Paper forwards
  the relevant native props/events and the replacement would broaden the
  MSP-002 merge surface.
- Enable scrolling only at 132 points: rejected because the iOS selection event
  can occur before that later React commit.
- Add layout or keyboard-container restructuring: rejected because the capped
  composer is already the final sibling inside the keyboard-avoiding view.

## Consequences

- iOS native caret tracking is active before a paste crosses the cap.
- Visual growth remains content-driven; internal scrolling has no effect until
  content exceeds the visible height.
- Signed physical-iPhone smoke remains the authority for UIKit behavior,
  keyboard transitions, Dynamic Type, VoiceOver, attachments, and compact
  widths.
