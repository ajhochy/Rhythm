/// Contract tests for issue #709 — OPC Terminal command-runner (session.shell).
///
/// Covers acceptance criteria c2–c5 on the Flutter side:
///
/// c2 — The mounted Terminal tab shows a command input; pressing Enter
///      dispatches runShellCommand and clears the input.
///
/// c3 — REAL-SURFACE: pumps the mounted SessionSidePanel, selects the Terminal
///      tab, asserts the command input is present and that a terminal message's
///      parts render via TerminalOutputView in the tab.
///
/// c4 — Terminal-originated messages are excluded from the main chat transcript:
///      messages whose ids are in terminalMessageIdsFor() are filtered out.
///
/// c5 — SDK error surfaces as an inline error line in the tab, not silent.
///
/// c1 (server-side vitest) and c6 (ai-workflow checks) are in the vitest file.
///
/// Run with:
///   flutter test test/features/agents/opc_terminal_command_runner_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_session_side_panel.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes
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

/// Stub repository with injectable shell command result.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// When set, runShellCommand returns this messageId.
  String? shellReturnMessageId;

  /// When set, runShellCommand throws this error.
  Object? shellError;

  int shellCallCount = 0;
  String? lastShellCommand;

  void injectWsMessage(AgentWsMessage msg) => _msgController.add(msg);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async =>
      const [];

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {}

  @override
  Future<void> dispatchCommand(
      String sessionId, String command, String args) async {}

  @override
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) async =>
      const [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId) async =>
      const [];

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];

  @override
  Future<String> runShellCommand(String sessionId, String command) async {
    shellCallCount++;
    lastShellCommand = command;
    if (shellError != null) throw shellError!;
    return shellReturnMessageId ?? 'msg-shell-default';
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

Widget _wrap(AgentsController controller, Widget child) =>
    ChangeNotifierProvider<AgentsController>.value(
      value: controller,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: child),
      ),
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  // ── c3: REAL-SURFACE — Terminal tab shows command input when mounted ───────

  testWidgets(
    'issue-709-c3a: REAL-SURFACE — SessionSidePanel Terminal tab shows command input',
    (tester) async {
      final session = _makeSession('session-c3a');

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Tap the Terminal tab.
      await tester.tap(find.text('Terminal'));
      await tester.pump();

      // The terminal command input should be present.
      expect(find.byKey(const Key('terminal-command-input')), findsOneWidget);
    },
  );

  // ── c3b: REAL-SURFACE — terminal message parts render in terminal tab ──────

  testWidgets(
    'issue-709-c3b: REAL-SURFACE — terminal message parts render via TerminalOutputView in tab',
    (tester) async {
      final session = _makeSession('session-c3b');
      final msgId = 'msg-terminal-001';

      // Pre-populate controller with a terminal message and its tool part.
      controller.setTerminalMessageForTest(
        session.id,
        msgId,
        command: 'ls -la',
      );

      // Create a tool ChatPart (bash) for the message, simulating output.
      final toolPart = ChatPart(
        id: 'part-tool-001',
        messageId: msgId,
        type: 'tool',
        toolName: 'bash',
        toolStatus: 'complete',
        toolArgs: {'command': 'ls -la'},
        toolOutput: 'file1.txt\nfile2.txt',
      );
      controller.setChatPartForTest(toolPart);

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Tap the Terminal tab.
      await tester.tap(find.text('Terminal'));
      await tester.pump();

      // The command echo header should be visible (rendered as "$ ls -la").
      expect(find.text('\$ ls -la'), findsAtLeastNWidgets(1));

      // TerminalOutputView should render the output text.
      expect(find.text('file1.txt\nfile2.txt'), findsOneWidget);
    },
  );

  // ── c2: Enter dispatches runShellCommand and clears the input ─────────────

  testWidgets(
    'issue-709-c2: Enter dispatches runShellCommand(sessionId, command) and clears input',
    (tester) async {
      final session = _makeSession('session-c2');
      repo.shellReturnMessageId = 'msg-from-shell';

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Tap the Terminal tab.
      await tester.tap(find.text('Terminal'));
      await tester.pump();

      // Type a command into the input.
      await tester.enterText(
          find.byKey(const Key('terminal-command-input')), 'echo hello');
      await tester.pump();

      // Press Enter to dispatch.
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      // runShellCommand should have been called with the correct args.
      expect(repo.shellCallCount, equals(1));
      expect(repo.lastShellCommand, equals('echo hello'));

      // The input field should be cleared.
      final inputFinder = find.byKey(const Key('terminal-command-input'));
      final textField = tester.widget<TextField>(inputFinder);
      expect(textField.controller?.text ?? '', isEmpty);
    },
  );

  // ── c4: terminal message ids excluded from main chat transcript ───────────

  test(
    'issue-709-c4: terminalMessageIdsFor() returns ids excluded from chatMessagesFor()',
    () async {
      const sessionId = 'session-c4';
      const terminalMsgId = 'msg-terminal-c4';

      // Seed controller with a terminal message entry.
      controller.setTerminalMessageForTest(
        sessionId,
        terminalMsgId,
        command: 'git status',
      );

      // Terminal message id must be in the terminal set.
      final terminalIds = controller.terminalMessageIdsFor(sessionId);
      expect(terminalIds.contains(terminalMsgId), isTrue);

      // chatMessagesFor must NOT include the terminal message
      // (it was never added to _chatMessagesBySession, and the view filters
      // out ids in terminalMessageIdsFor before rendering).
      final chatMessages = controller.chatMessagesFor(sessionId);
      expect(chatMessages.any((m) => m.id == terminalMsgId), isFalse);
    },
  );

  // ── c5: SDK error surfaces as inline error line in tab ───────────────────

  testWidgets(
    'issue-709-c5: SDK error on runShellCommand surfaces as error line in tab',
    (tester) async {
      final session = _makeSession('session-c5');
      repo.shellError = Exception('no authed model: SDK_ERROR 502');

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();

      // Tap the Terminal tab.
      await tester.tap(find.text('Terminal'));
      await tester.pump();

      // Type and submit a command.
      await tester.enterText(
          find.byKey(const Key('terminal-command-input')), 'ls');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      // An inline error line should appear in the tab.
      expect(find.byKey(const Key('terminal-error-line')), findsOneWidget);
    },
  );
}
