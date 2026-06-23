# C3 — Email Flutter feature + nav row

**Labels:** `feature`, `flutter`, `phase-c`
**Depends on:** A1, C1, C2

## Context

With the MCP role gating (C1) and the signals endpoint + role file (C2) in place, this issue builds the Flutter `agent_email` feature: a view showing recent Gmail signals fetched from the C2 endpoint, plus a "Launch email assistant" button that creates a new agent session scoped to the `email-assistant` MCP role via the C1 extension. The feature slots into the nav column as a 📧 Email TOOLS row.

## Likely files

- NEW `apps/desktop_flutter/lib/features/agent_email/models/gmail_signal.dart`
- NEW `apps/desktop_flutter/lib/features/agent_email/data/agent_email_data_source.dart`
- NEW `apps/desktop_flutter/lib/features/agent_email/repositories/agent_email_repository.dart`
- NEW `apps/desktop_flutter/lib/features/agent_email/controllers/agent_email_controller.dart`
- NEW `apps/desktop_flutter/lib/features/agent_email/views/agent_email_view.dart`
- `apps/desktop_flutter/lib/main.dart` (add `ChangeNotifierProvider<AgentEmailController>`)
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart` (add 📧 Email row)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (pass `mcpRole` when creating a session — new optional param)

## Acceptance criteria

- [ ] `GmailSignal` model has fields: `id`, `fromName`, `fromEmail`, `subject`, `snippet`, `receivedAt`, `isUnread`; with `fromJson`.
- [ ] `AgentEmailDataSource` fetches from the C2 endpoint using `AppConstants.agentLocalBaseUrl` is WRONG here — this is a production-server endpoint. Use `serverConfigService.url` as `baseUrl` for the signals fetch (gmail signals live on the production server, NOT the local agent server at :4001).
- [ ] `AgentEmailView` renders a list of recent signals (from name, subject, snippet, received-at timestamp, unread indicator).
- [ ] An empty-state message renders when there are no signals.
- [ ] A "Launch email assistant" button calls `AgentsController.createSession(mcpRole: 'email-assistant')` which passes `mcpRole` in the POST body to the local agent server (`:4001/agent-sessions`).
- [ ] After launching, the newly created session is selected in the CHATS list and the transcript pane opens.
- [ ] `AgentEmailController` is registered in `main.dart` MultiProvider.
- [ ] The TOOLS group includes a 📧 Email row that opens `AgentEmailView`.
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Assert the 📧 Email row renders.
- Tap the Email row and assert `AgentEmailView` is pushed.
- Pump `AgentEmailView` with a mocked controller returning two signals; assert both subject lines render.
- Assert the "Launch email assistant" button is present.
- Tap the launch button with a mocked `AgentsController`; assert `createSession` was called with `mcpRole: 'email-assistant'`.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Security notes

- The `mcpRole` value passed to `createSession` is a hardcoded string literal `'email-assistant'` — it is NOT derived from user input.
- Email feature is MCP-only. There is no IMAP/SMTP client in this feature (out of scope per spec).

## Data-safety out-of-scope

No new database tables in this issue. No api_server changes (backend is C1 + C2).
