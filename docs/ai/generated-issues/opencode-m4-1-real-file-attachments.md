# OPC-M4-1 — Real image/file attachments (FilePart with data URI)

**Milestone:** M4 — Input & config
**Branch:** `opc-m4-1-real-file-attachments`
**Depends on:** OPC-M1-3

## Summary

The paperclip attaches real content: selected files are read as bytes and sent as an OpenCode
`FilePart` (`{type:'file', mime, filename, url: 'data:<mime>;base64,...'}`) alongside the text
part in the prompt's parts array. Attached images render as thumbnails in the user's transcript
bubble; non-image files as a filename chip. Pasting an image into the composer attaches it.

## Motivation

Audit B PARTIAL: "image attachments send `[image] /path` text not bytes" — the model never sees
the image, it sees a useless path string. Vision-capable models are already in the picker.

## Likely files

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (build parts array)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (composer chips + bubble thumbnails)
- `apps/api_server/src/services/ws_gateway.ts` (accept parts incl. FilePart in `session.input`)
- `apps/api_server/src/services/opencode_client_service.ts` (prompt forwards parts verbatim)

## Acceptance criteria

1. WS `session.input` with a parts array containing a FilePart forwards that part to the SDK prompt unmodified (vitest spy: parts array deep-equals, data URI intact); oversized payloads respect/raise the WS+express body limits with a clear error frame, not a silent drop (test at limit boundary).
2. Attaching an image file produces a FilePart whose url is `data:image/<ext>;base64,<payload>` matching the file bytes (controller unit test on a small fixture PNG) — and the prompt no longer contains any `[image]` text token (grep-level regression: the legacy formatter is deleted).
3. Composer shows a removable chip per pending attachment; removing it excludes the part from the send.
4. Sent images render as a bounded thumbnail in the user bubble; non-image files render a filename chip (widget tests).
5. Rehydrated file parts (M1-2 persistence) render the same as streamed ones.
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: gateway parts-forwarding contract (c1).
- flutter test: `opc_m4_1_attachments_test.dart` (c2-c5).

## Out of scope

- Drag-and-drop (follow-up if the osascript picker UX proves clunky). Attachment size compression. Non-data-URI file references via opencode's file API.
