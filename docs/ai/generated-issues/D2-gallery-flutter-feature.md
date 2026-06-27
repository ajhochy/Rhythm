# D2 — Gallery Flutter feature + nav row

**Labels:** `feature`, `flutter`, `phase-d`
**Depends on:** A1, C1, D1

## Context

With the `graphic-designer` role and `agent_designs` table in place (D1) and init-time MCP gating available (C1), this issue builds the Flutter `agent_gallery` feature: a "Launch designer" button that creates a session scoped to `graphic-designer`, and a grid of produced designs (thumbnail, title, Canva link) from the D1 endpoint. It slots into the nav column as a 🎨 Gallery TOOLS row.

## Likely files

- NEW `apps/desktop_flutter/lib/features/agent_gallery/models/agent_design.dart`
- NEW `apps/desktop_flutter/lib/features/agent_gallery/data/agent_gallery_data_source.dart`
- NEW `apps/desktop_flutter/lib/features/agent_gallery/repositories/agent_gallery_repository.dart`
- NEW `apps/desktop_flutter/lib/features/agent_gallery/controllers/agent_gallery_controller.dart`
- NEW `apps/desktop_flutter/lib/features/agent_gallery/views/agent_gallery_view.dart`
- `apps/desktop_flutter/lib/main.dart` (add `ChangeNotifierProvider<AgentGalleryController>`)
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart` (add 🎨 Gallery row)

## Acceptance criteria

- [ ] `AgentDesign` model has fields: `id`, `title`, `canvaUrl`, `thumbnailUrl`, `sessionId`, `createdAt`; with `fromJson`.
- [ ] `AgentGalleryDataSource` fetches `GET /agent-designs` from the local agent server (`AppConstants.agentLocalBaseUrl` = `:4001`) — design records are stored on the local agent server, NOT the production server.
- [ ] `AgentGalleryView` renders a grid (2–3 columns) of design cards, each showing thumbnail (or a placeholder if `thumbnailUrl` is null), title, and a "Open in Canva" link button that calls `url_launcher` with `canvaUrl`.
- [ ] An empty-state message renders when there are no designs.
- [ ] A "Launch designer" button calls `AgentsController.createSession(mcpRole: 'graphic-designer')`, which passes `mcpRole` in the POST body to `:4001/agent-sessions` (via the C1 extension).
- [ ] After launching, the newly created session is selected in the CHATS list and the transcript pane opens.
- [ ] `AgentGalleryController` is registered in `main.dart` MultiProvider.
- [ ] The TOOLS group includes a 🎨 Gallery row that opens `AgentGalleryView`.
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Assert the 🎨 Gallery row renders.
- Tap the Gallery row and assert `AgentGalleryView` is pushed.
- Pump `AgentGalleryView` with a mocked controller returning two design records; assert both titles render.
- Assert the "Launch designer" button is present.
- Tap the launch button with a mocked `AgentsController`; assert `createSession` was called with `mcpRole: 'graphic-designer'`.
- Assert the "Open in Canva" button is present for a design with a non-null `canvaUrl`.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Security notes

- The `mcpRole` value `'graphic-designer'` is a hardcoded string literal — NOT derived from user input.
- "Open in Canva" link opens `canvaUrl` via `url_launcher`. The URL is stored server-side and not user-supplied in this flow (set by the agent during session), so SSRF validation applies at write time on the agent server, not here.

## Data-safety out-of-scope

No api_server changes in this issue (backend is D1). No gmail / email changes.
