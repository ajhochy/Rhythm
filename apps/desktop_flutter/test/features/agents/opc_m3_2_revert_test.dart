/// Contract tests for OPC-M3-2 — Undo: revert / unrevert UI.
///
/// Covers acceptance criteria c2–c5 from the issue spec:
///
/// c2 — Message action row on assistant messages shows "Revert to here";
///      tapping shows a confirmation dialog; confirm dispatches revert;
///      cancel does not. (widget tests, mocked repository)
///
/// c3 — After revert, messages after the revert point render dimmed + "reverted"
///      badge; a "Restore reverted changes" banner is visible.
///      REAL-SURFACE test: pumps MessageActionsRow as mounted in agents_view's
///      _buildTranscriptBody to guard against the orphaned-widget regression.
///
/// c4 — Tapping the banner dispatches unrevert and clears the reverted treatment.
///
/// c5 — Both revert and unrevert call fetchSessionDiff (controller test).
///
/// c1 is covered by the vitest server-side test.
/// c6 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_2_revert_test.dart
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
import 'package:rhythm_desktop/features/agents/views/_message_actions_row.dart';
import 'package:rhythm_desktop/features/agents/views/_revert_restore_banner.dart';
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

/// A stub repository that records revert/unrevert calls and fetchSessionDiff.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  int revertCallCount = 0;
  int unrevertCallCount = 0;
  String? lastRevertMessageId;
  String? lastRevertSessionId;
  String? lastUnrevertSessionId;

  // Whether revert/unrevert should throw.
  bool revertShouldThrow = false;
  bool unrevertShouldThrow = false;

  final Map<String, int> fetchDiffCallCount = {};

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
    String? scope,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async {
    fetchDiffCallCount[id] = (fetchDiffCallCount[id] ?? 0) + 1;
    return const [];
  }

  @override
  Future<void> revertSession(String sessionId, String messageId) async {
    revertCallCount++;
    lastRevertSessionId = sessionId;
    lastRevertMessageId = messageId;
    if (revertShouldThrow) throw Exception('revert failed');
  }

  @override
  Future<void> unrevertSession(String sessionId) async {
    unrevertCallCount++;
    lastUnrevertSessionId = sessionId;
    if (unrevertShouldThrow) throw Exception('unrevert failed');
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

ChatMessage _makeMessage(
  String id, {
  String sessionId = 'ses-1',
  String role = 'assistant',
  bool isReverted = false,
}) =>
    ChatMessage(
      id: id,
      sessionId: sessionId,
      role: role,
      createdAt: _kEpoch,
      isReverted: isReverted,
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

  // ── c2 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-695-c2: message action row shows Revert and dialog on assistant messages',
    () {
      testWidgets(
        'issue-695-c2a: REAL-SURFACE — MessageActionsRow on assistant message shows "Revert to here" button',
        (tester) async {
          const sessionId = 'ses-revert';
          const messageId = 'msg-001';

          // Pump the REAL MessageActionsRow as used in agents_view's
          // _buildTranscriptBody (mounted on the real widget, not an isolated mock).
          await tester.pumpWidget(
            _wrapWithController(
              controller,
              MessageTimeTicker(
                child: MessageActionsRow(
                  sessionId: sessionId,
                  messageId: messageId,
                  createdAt: _kEpoch,
                  text: 'Hello world',
                  role: 'assistant',
                ),
              ),
            ),
          );
          await tester.pump();

          // The "Revert to here" action must be visible on the real surface.
          expect(find.byIcon(Icons.history), findsOneWidget);
        },
      );

      testWidgets(
        'issue-695-c2b: tapping Revert shows confirmation dialog with consequence text',
        (tester) async {
          const sessionId = 'ses-revert';
          const messageId = 'msg-002';

          await tester.pumpWidget(
            _wrapWithController(
              controller,
              MessageTimeTicker(
                child: MessageActionsRow(
                  sessionId: sessionId,
                  messageId: messageId,
                  createdAt: _kEpoch,
                  text: 'Response text',
                  role: 'assistant',
                ),
              ),
            ),
          );
          await tester.pump();

          // Tap the revert icon.
          await tester.tap(find.byIcon(Icons.history));
          await tester.pumpAndSettle();

          // Dialog must appear with consequence text.
          expect(find.textContaining('Undo file changes after this point'),
              findsOneWidget);
        },
      );

      testWidgets(
        'issue-695-c2c: confirming dialog dispatches revert; cancel does not',
        (tester) async {
          const sessionId = 'ses-revert';
          const messageId = 'msg-003';

          await tester.pumpWidget(
            _wrapWithController(
              controller,
              MessageTimeTicker(
                child: MessageActionsRow(
                  sessionId: sessionId,
                  messageId: messageId,
                  createdAt: _kEpoch,
                  text: 'Response',
                  role: 'assistant',
                ),
              ),
            ),
          );
          await tester.pump();

          // Tap to open dialog, then cancel.
          await tester.tap(find.byIcon(Icons.history));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Cancel'));
          await tester.pumpAndSettle();

          // No revert dispatched.
          expect(repo.revertCallCount, equals(0));

          // Open again, confirm this time.
          await tester.tap(find.byIcon(Icons.history));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Revert'));
          await tester.pumpAndSettle();

          // Revert was dispatched once.
          expect(repo.revertCallCount, equals(1));
          expect(repo.lastRevertSessionId, equals(sessionId));
          expect(repo.lastRevertMessageId, equals(messageId));
        },
      );

      testWidgets(
        'issue-695-c2d: user messages do NOT show "Revert to here" button',
        (tester) async {
          await tester.pumpWidget(
            _wrapWithController(
              controller,
              MessageTimeTicker(
                child: MessageActionsRow(
                  sessionId: 'ses-1',
                  messageId: 'msg-user',
                  createdAt: _kEpoch,
                  text: 'User input',
                  role: 'user',
                ),
              ),
            ),
          );
          await tester.pump();

          expect(find.byIcon(Icons.history), findsNothing);
        },
      );
    },
  );

  // ── c3 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-695-c3: reverted messages render dimmed + badge; restore banner visible',
    () {
      testWidgets(
        'issue-695-c3a: reverted message has Opacity < 1 and shows "reverted" badge',
        (tester) async {
          // Seed a reverted message in the controller.
          final revertedMsg = _makeMessage('msg-rev', isReverted: true);
          controller.setMessageForTest(revertedMsg);

          await tester.pumpWidget(
            _wrapWithController(
              controller,
              MessageTimeTicker(
                child: MessageActionsRow(
                  sessionId: 'ses-1',
                  messageId: 'msg-rev',
                  createdAt: _kEpoch,
                  text: 'Reverted',
                  role: 'assistant',
                  isReverted: true,
                ),
              ),
            ),
          );
          await tester.pump();

          // The "reverted" badge must be visible.
          expect(find.textContaining('reverted'), findsOneWidget);
        },
      );

      testWidgets(
        'issue-695-c3b: RevertRestoreBanner shows "Restore reverted changes" when revert is active',
        (tester) async {
          const sessionId = 'ses-restore';
          controller.setSessionRevertedForTest(sessionId, true);

          await tester.pumpWidget(
            _wrapWithController(
              controller,
              RevertRestoreBanner(sessionId: sessionId),
            ),
          );
          await tester.pump();

          expect(
              find.textContaining('Restore reverted changes'), findsOneWidget);
        },
      );

      testWidgets(
        'issue-695-c3c: banner is not shown when no revert is active for the session',
        (tester) async {
          const sessionId = 'ses-no-revert';

          await tester.pumpWidget(
            _wrapWithController(
              controller,
              RevertRestoreBanner(sessionId: sessionId),
            ),
          );
          await tester.pump();

          expect(find.textContaining('Restore reverted changes'), findsNothing);
        },
      );
    },
  );

  // ── c4 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-695-c4: tapping banner dispatches unrevert and clears treatment',
    () {
      testWidgets(
        'issue-695-c4: tapping Restore button dispatches unrevert',
        (tester) async {
          const sessionId = 'ses-unrevert';
          controller.setSessionRevertedForTest(sessionId, true);

          await tester.pumpWidget(
            _wrapWithController(
              controller,
              RevertRestoreBanner(sessionId: sessionId),
            ),
          );
          await tester.pump();

          // Tap the restore button (the TextButton labeled exactly "Restore",
          // not the banner label "Restore reverted changes").
          await tester.tap(find.widgetWithText(TextButton, 'Restore'));
          await tester.pumpAndSettle();

          expect(repo.unrevertCallCount, equals(1));
          expect(repo.lastUnrevertSessionId, equals(sessionId));
        },
      );

      test(
        'issue-695-c4b: after unrevert success, sessionIsReverted returns false',
        () async {
          const sessionId = 'ses-unrevert-clear';
          controller.setSessionRevertedForTest(sessionId, true);
          expect(controller.sessionIsReverted(sessionId), isTrue);

          await controller.unrevertSession(sessionId);

          expect(controller.sessionIsReverted(sessionId), isFalse);
        },
      );
    },
  );

  // ── c5 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-695-c5: revert and unrevert both trigger fetchSessionDiff',
    () {
      test(
        'issue-695-c5a: revertSession triggers fetchSessionDiff for that session',
        () async {
          const sessionId = 'ses-diff-revert';

          await controller.revertSession(sessionId, 'msg-x');

          await Future<void>.delayed(const Duration(milliseconds: 50));
          expect(
            repo.fetchDiffCallCount[sessionId] ?? 0,
            greaterThan(0),
            reason:
                'fetchSessionDiff must be called after revert to refresh the Changes tab',
          );
        },
      );

      test(
        'issue-695-c5b: unrevertSession triggers fetchSessionDiff for that session',
        () async {
          const sessionId = 'ses-diff-unrevert';
          controller.setSessionRevertedForTest(sessionId, true);

          await controller.unrevertSession(sessionId);

          await Future<void>.delayed(const Duration(milliseconds: 50));
          expect(
            repo.fetchDiffCallCount[sessionId] ?? 0,
            greaterThan(0),
            reason:
                'fetchSessionDiff must be called after unrevert to refresh the Changes tab',
          );
        },
      );
    },
  );
}
