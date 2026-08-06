/// Contract tests for OPC-M4-2 — Session fork.
///
/// Covers acceptance criterion c4 from the issue spec:
///
/// c4 — "Fork from here" in the message action row dispatches the call;
///      the new session appears in the active list (optimistic, reconciled
///      by REST response) and selecting it shows the copied transcript
///      (controller/widget tests with fakes).
///
/// REAL-SURFACE test: pumps the actual MessageActionsRow as mounted in
/// agents_view's _buildTranscriptBody to guard against orphaned-widget
/// regression (#694 pattern). The "Fork from here" icon must be visible
/// on the real surface and tapping it must dispatch forkSession.
///
/// c1–c3, c5 are covered by the vitest server-side test.
/// c6 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m4_2_fork_test.dart
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
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_message_actions_row.dart';
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

/// A stub repository that records forkSession calls and provides
/// configurable return values for testing.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  int forkCallCount = 0;
  String? lastForkSessionId;
  String? lastForkMessageId;
  AgentSession? forkReturnValue;
  bool forkShouldThrow = false;

  // Optional messages to return when getSession is called for the fork.
  Map<String, List<AgentSessionMessage>> sessionMessages = {};

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
  bool send(Map<String, dynamic> msg) => true;

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: sessionMessages[id] ?? const <AgentSessionMessage>[],
          );

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    forkCallCount++;
    lastForkSessionId = sessionId;
    lastForkMessageId = messageId;
    if (forkShouldThrow) throw Exception('fork failed');
    return forkReturnValue ?? _makeSession('fork-${sessionId.substring(0, 4)}');
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id, {String? name}) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: name ?? 'Test Session $id',
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

Widget _wrapWithController(AgentsController controller, Widget child) =>
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

  tearDown(() {
    controller.dispose();
  });

  // ── c4a: REAL-SURFACE — action row shows "Fork from here" icon ───────────────

  testWidgets(
    'issue-701-c4a: REAL-SURFACE — MessageActionsRow on assistant message shows fork icon',
    (tester) async {
      const sessionId = 'ses-fork-real';
      const messageId = 'msg-fork-001';

      // Pump the REAL MessageActionsRow as used in agents_view's
      // _buildTranscriptBody with role='assistant' — the same signature
      // used by _buildTranscriptBody prevents orphaned-widget regression.
      await tester.pumpWidget(
        _wrapWithController(
          controller,
          MessageTimeTicker(
            child: MessageActionsRow(
              sessionId: sessionId,
              messageId: messageId,
              createdAt: _kEpoch,
              text: 'assistant response',
              role: 'assistant',
            ),
          ),
        ),
      );
      await tester.pump();

      // The "Fork from here" icon must be visible on the real surface.
      expect(find.byIcon(Icons.fork_right), findsOneWidget);
    },
  );

  // ── c4b: tapping fork icon dispatches forkSession on controller ─────────────

  testWidgets(
    'issue-701-c4b: tapping "Fork from here" dispatches forkSession',
    (tester) async {
      const sessionId = 'ses-fork-dispatch';
      const messageId = 'msg-fork-002';

      // Prepare fork return value.
      final forkSession =
          _makeSession('forked-session-id', name: 'Test Session (fork)');
      repo.forkReturnValue = forkSession;

      await tester.pumpWidget(
        _wrapWithController(
          controller,
          MessageTimeTicker(
            child: MessageActionsRow(
              sessionId: sessionId,
              messageId: messageId,
              createdAt: _kEpoch,
              text: 'assistant response',
              role: 'assistant',
            ),
          ),
        ),
      );
      await tester.pump();

      // Tap the fork icon — this opens the confirmation dialog.
      await tester.tap(find.byIcon(Icons.fork_right));
      await tester.pumpAndSettle();

      // Confirm the dialog by tapping "Fork".
      expect(find.text('Fork'), findsOneWidget);
      await tester.tap(find.text('Fork'));
      await tester.pumpAndSettle();

      // Repository must have been called.
      expect(repo.forkCallCount, 1);
      expect(repo.lastForkSessionId, sessionId);
      expect(repo.lastForkMessageId, messageId);
    },
  );

  // ── c4c: forked session appears in active list ───────────────────────────────

  test(
    'issue-701-c4c: forkSession adds forked session to active sessions list',
    () async {
      const sessionId = 'ses-fork-list';
      const messageId = 'msg-fork-003';

      // Seed parent session.
      controller.setActiveSessionForTest(
        sessionId,
        _makeSession(sessionId, name: 'List Parent'),
      );

      final forkSession =
          _makeSession('fork-list-new', name: 'List Parent (fork)');
      repo.forkReturnValue = forkSession;

      await controller.forkSession(sessionId, messageId);

      // Fork must appear in the sessions list.
      expect(
        controller.sessions.any((s) => s.id == 'fork-list-new'),
        isTrue,
      );
    },
  );

  // ── c4d: selecting forked session shows its transcript ──────────────────────

  test(
    'issue-701-c4d: selecting forked session loads its messages',
    () async {
      const sessionId = 'ses-fork-transcript';
      const messageId = 'msg-fork-004';

      controller.setActiveSessionForTest(
        sessionId,
        _makeSession(sessionId, name: 'Transcript Parent'),
      );

      final forkId = 'fork-transcript-new';
      final forkSession =
          _makeSession(forkId, name: 'Transcript Parent (fork)');
      repo.forkReturnValue = forkSession;

      // Provide messages for the fork session's getSession call.
      repo.sessionMessages[forkId] = [
        AgentSessionMessage(
          id: 1,
          sessionId: forkId,
          role: 'input',
          rawText: 'user message',
          strippedText: 'user message',
          createdAt: _kEpoch,
        ),
      ];

      await controller.forkSession(sessionId, messageId);

      // Select the forked session.
      await controller.selectSession(forkId);

      // Messages must be populated for the fork.
      final messages = controller.chatMessagesFor(forkId);
      expect(messages.isNotEmpty, isTrue);
    },
  );

  // ── c4e: user messages do NOT show fork icon ─────────────────────────────────

  testWidgets(
    'issue-701-c4e: "Fork from here" icon is not shown for user messages',
    (tester) async {
      const sessionId = 'ses-fork-user';
      const messageId = 'msg-fork-005';

      await tester.pumpWidget(
        _wrapWithController(
          controller,
          MessageTimeTicker(
            child: MessageActionsRow(
              sessionId: sessionId,
              messageId: messageId,
              createdAt: _kEpoch,
              text: 'user input',
              role: 'user',
            ),
          ),
        ),
      );
      await tester.pump();

      // Fork icon must NOT appear for user messages.
      expect(find.byIcon(Icons.fork_right), findsNothing);
    },
  );
}
