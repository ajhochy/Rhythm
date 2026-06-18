---
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# OPC-M4-1: attachment state in controller, not view (handleInputFrame extraction)

**Context:** Issue #700 required real FilePart forwarding to the SDK. Two key non-obvious choices:

1. **Attachment pending-state in `AgentsController`, not `_InputAreaState`** — Prior approach stored attachment chips in local `StatefulWidget` state. Moving to controller means widget tests can `setPendingAttachmentsForTest()` without simulating file-picker UI events. It also means `sendInput()` can merge them internally, keeping the repository interface unchanged (no new `AgentsRepository` method, avoiding the 23+ stub-file update tax).

2. **`handleInputFrame` extracted as exported `async function`** — The `session.input` async IIFE in `handleClientMessage` was extracted to a named exported function (matching the `handleCommandFrame` pattern). The vitest test imports it directly. Alternatives rejected: (a) testing via a full WS server — too heavyweight; (b) keeping the IIFE and wrapping it — requires an internal mock mechanism. Named export is the minimal correct change and satisfies the REAL-surface requirement by testing the exact code path the WS switch uses.

3. **`as unknown as` cast removed from `opencode_client_service.ts` by updating `.d.ts`** — Issue #685 had a constraint test checking zero `as unknown as` in that file. The previous session's implementation introduced one. Fix: add `FilePartInput` + `PartInput` union to the hand-typed `.d.ts` so the SDK call is fully typed. The `as unknown as` cast in `ws_gateway.ts` (for `.bind()` return type preservation) is in a different file not checked by the constraint test and is kept intentionally per the #604 regression note.

**Consequences:**
- + Controller-held attachment state is trivially testable and survives widget rebuilds.
- + `AgentsRepository` interface unchanged — no stub tax.
- + Issue #685 constraint continues to hold (zero `as unknown as` in `opencode_client_service.ts`).
- - `_pickFiles()` still needs real file access at runtime; test coverage uses injected data URIs (not live file picker).
