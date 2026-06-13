/// FULL-STACK UI → HTTP test for the Terminal command-runner (OPC-M1-6 / #709).
///
/// This is the UI analog of the backend route test
/// (apps/api_server/src/__tests__/opc_agent_session_routes.test.ts): it drives
/// the REAL widget tree and asserts the REAL outgoing HTTP request, faking ONLY
/// the network transport.
///
///   pump TerminalTab (REAL)
///     -> AgentsController.runShellCommand (REAL)
///       -> AgentsRepository.runShellCommand (REAL)
///         -> AgentsDataSource.runShellCommand (REAL — builds URL + JSON body)
///           -> http.Client  <-- the ONLY fake (MockClient captures the request)
///
/// Because the fake sits at the network boundary (not at the repository or
/// service layer), a regression in the data source — wrong path
/// (`/shell` typo), wrong JSON key (`cmd` vs `command`), wrong method — surfaces
/// here as a failed assertion on the captured request, NOT a green false
/// positive. This guards the same false-green family we removed on the server
/// side, but from the button the user actually clicks.
///
/// Run with:
///   flutter test test/features/agents/opc_terminal_button_http_test.dart
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_terminal_tab.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Test doubles that are NOT the boundary under test.
//
// The agent server is forced "ready" so the controller behaves as it would in
// production; the API server process is never spawned. These are scaffolding,
// not the thing being verified — the verification is the captured HTTP request.
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ReadyAgentServerController extends AgentServerController {
  _ReadyAgentServerController() : super(_FakeApiServerService());

  @override
  AgentServerStatus get status => AgentServerStatus.ready;

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;
}

/// Captures every request the MockClient sees, then returns whatever the
/// current test queued via [responder].
class _CapturingTransport {
  final List<http.Request> requests = [];
  late http.Response Function(http.Request request) responder;

  MockClient build() => MockClient((request) async {
        // package:http hands a streamed request to the handler as http.Request.
        requests.add(request);
        return responder(request);
      });

  http.Request get lastRequest => requests.last;
}

const _kSessionId = 'sess-terminal-1';

AgentsController _buildController(AgentsRepository repo) => AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

Widget _wrap(AgentsController controller) =>
    ChangeNotifierProvider<AgentsController>.value(
      value: controller,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(
          body: SizedBox(
            width: 600,
            height: 800,
            child: TerminalTab(sessionId: _kSessionId),
          ),
        ),
      ),
    );

/// Types [command] into the real input field and fires the submit action the
/// keyboard's "done"/Enter triggers — exactly what a user does.
Future<void> _typeAndSubmit(WidgetTester tester, String command) async {
  await tester.enterText(
    find.byKey(const Key('terminal-command-input')),
    command,
  );
  await tester.testTextInput.receiveAction(TextInputAction.done);
  await tester.pumpAndSettle();
}

void main() {
  late _CapturingTransport transport;
  late AgentsDataSource dataSource;
  late AgentsController controller;

  setUp(() {
    transport = _CapturingTransport();
    // Default: a healthy shell response. Individual tests override the body.
    transport.responder = (_) => http.Response(
          jsonEncode({'messageId': 'msg-shell-1'}),
          200,
          headers: {'content-type': 'application/json'},
        );
    // REAL data source + REAL repository — only the http.Client is faked.
    dataSource = AgentsDataSource(client: transport.build());
    controller = _buildController(AgentsRepository(dataSource));
  });

  tearDown(() => controller.dispose());

  testWidgets(
    'pressing Enter POSTs /agent-sessions/:id/shell with body {"command": ...} '
    'and renders the command echo (happy path)',
    (tester) async {
      await tester.pumpWidget(_wrap(controller));
      await tester.pumpAndSettle();

      // Empty state before any command.
      expect(find.text('Run a command to get started.'), findsOneWidget);

      await _typeAndSubmit(tester, 'ls -la');

      // --- The REAL outgoing request is the assertion that matters. ---
      expect(transport.requests, hasLength(1));
      final req = transport.lastRequest;
      expect(req.method, 'POST');
      expect(
        req.url.path,
        '/agent-sessions/$_kSessionId/shell',
        reason: 'wrong path would have been a silent false-green before',
      );
      // The body shape the backend contract expects: { "command": "<cmd>" }.
      final decoded = jsonDecode(req.body) as Map<String, dynamic>;
      expect(decoded, {'command': 'ls -la'});

      // --- And the UI reflected the round-trip: the command echo rendered. ---
      expect(find.text('\$ ls -la'), findsOneWidget);
      expect(find.text('Run a command to get started.'), findsNothing);
    },
  );

  testWidgets('the command is trimmed before it reaches the wire', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(controller));
    await tester.pumpAndSettle();

    await _typeAndSubmit(tester, '   git status   ');

    expect(transport.requests, hasLength(1));
    final decoded =
        jsonDecode(transport.lastRequest.body) as Map<String, dynamic>;
    expect(decoded, {'command': 'git status'});
  });

  testWidgets('an empty / whitespace-only command never hits the network', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(controller));
    await tester.pumpAndSettle();

    await _typeAndSubmit(tester, '     ');

    expect(
      transport.requests,
      isEmpty,
      reason: 'the widget+controller guard must short-circuit before HTTP',
    );
    expect(find.text('Run a command to get started.'), findsOneWidget);
  });

  testWidgets(
    'a backend error surfaces as the inline terminal error line, never silent',
    (tester) async {
      // Override the transport to fail this command (502 from the route).
      transport.responder = (_) => http.Response(
            jsonEncode({
              'error': {'code': 'SDK_ERROR', 'message': 'boom'},
            }),
            502,
            headers: {'content-type': 'application/json'},
          );

      await tester.pumpWidget(_wrap(controller));
      await tester.pumpAndSettle();

      await _typeAndSubmit(tester, 'do-the-thing');

      // The request was still made (we exercised the real data source)...
      expect(transport.requests, hasLength(1));
      // ...and the failure is rendered inline, not swallowed.
      expect(find.byKey(const Key('terminal-error-line')), findsOneWidget);
    },
  );
}
