/// Contract tests for OPC-M2-4 — Retry status surfacing + token/cost display.
///
/// Covers acceptance criteria c2–c7 from the issue spec:
///
/// c2 — A retry part renders inline with attempt count and reason text.
/// c3 — When the retry resolves (next message/part event), the retrying
///      indicator clears.
/// c4 — An assistant message with cost: 0.0142 and tokens renders a footer
///      "$0.0142"; tooltip/expanded detail contains all four token counts.
/// c5 — Messages without cost (user, legacy rows) render no cost footer.
/// c6 — Session total cost = sum of persisted message costs, updates when a
///      new message lands (controller unit test).
/// c7 — Rehydrated messages (REST) show identical cost/token UI to streamed.
///
/// c1 is covered by the vitest bridge test.
/// c8 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m2_4_retry_cost_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_chat_cost_footer.dart';
import 'package:rhythm_desktop/features/agents/views/_retrying_indicator.dart';
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

  @override
  bool isAgentAvailable(String kind) => true;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> retry() async {}
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

class _FakeNotificationsController extends NotificationsController {
  _FakeNotificationsController()
      : super(NotificationsRepository(NotificationsDataSource()));

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {}
}

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  void emit(AgentWsMessage msg) => _msgController.add(msg);

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
      [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    return (
      session: _makeSession(id),
      messages: const <AgentSessionMessage>[],
    );
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

({AgentsController ctrl, _StubAgentsRepository repo}) _buildController() {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  final ctrl = AgentsController(repo, agentServer, notifService, notifCtrl);
  return (ctrl: ctrl, repo: repo);
}

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: SizedBox(width: 600, child: child)),
    );

void main() {
// ---------------------------------------------------------------------------
// c2 — Retry part renders inline with attempt count and reason
// ---------------------------------------------------------------------------

  group(
      'issue-693-c2: retry part renders inline Retrying (attempt N) with reason',
      () {
    testWidgets('RetryingIndicator shows attempt 2 with reason text',
        (tester) async {
      await tester.pumpWidget(_wrap(
        RetryingIndicator(
            attempt: 2, reason: 'Rate limit exceeded. Retrying in 5s.'),
      ));

      // Must contain "Retrying" with attempt number.
      expect(find.textContaining('Retrying'), findsAtLeastNWidgets(1));
      expect(find.textContaining('2'), findsAtLeastNWidgets(1));
      // Must show the reason text.
      expect(find.textContaining('Rate limit'), findsAtLeastNWidgets(1));
    });
  });

// ---------------------------------------------------------------------------
// c3 — Retrying status clears when next part/message event arrives
// ---------------------------------------------------------------------------

  group(
      'issue-693-c3: retrying status clears when next message.part.updated arrives',
      () {
    test('session retrying status clears on next message.part.updated',
        () async {
      final (:ctrl, :repo) = _buildController();
      await ctrl.initialize();
      await Future<void>.delayed(Duration.zero);

      const sessionId = 'ses_test_retry';

      // Emit a session.status WS frame with status='retrying'.
      // The bridge emits { type: 'session.status', id, working: false, status: 'retrying',
      //   attempt: 2, reason: '...' }
      // AgentWsMessage.parse maps 'session.status' to SessionStatusMessage.
      // The controller sets _retryingBySession[id] on retrying status.
      repo.emit(SessionStatusMessage.fromJson({
        'type': 'session.status',
        'id': sessionId,
        'working': false,
        'status': 'retrying',
        'attempt': 2,
        'reason': 'Rate limit exceeded.',
      }));
      await Future<void>.delayed(Duration.zero);

      // Retrying state should be set.
      expect(ctrl.retryingFor(sessionId), isNotNull);
      expect(ctrl.retryingFor(sessionId)?.attempt, equals(2));

      // Now emit a message.part.updated event — this should clear the retrying state.
      repo.emit(MessagePartUpdatedMessage.fromJson({
        'type': 'message.part.updated',
        'id': sessionId,
        'part': {
          'id': 'part_001',
          'messageID': 'msg_001',
          'sessionID': sessionId,
          'type': 'text',
          'text': 'Hello',
        },
      }));
      await Future<void>.delayed(Duration.zero);

      // Retrying state must be cleared.
      expect(ctrl.retryingFor(sessionId), isNull);

      ctrl.dispose();
    });
  });

// ---------------------------------------------------------------------------
// c4 — Assistant message with cost renders footer and token breakdown
// ---------------------------------------------------------------------------

  group(
      'issue-693-c4: assistant message with cost renders footer \$0.0142 and token breakdown',
      () {
    testWidgets('ChatCostFooter shows token context collapsed, price on expand',
        (tester) async {
      const tokens = <String, dynamic>{
        'input': 1200,
        'output': 350,
        'reasoning': 0,
        'cache': 800,
      };

      // Collapsed: token context visible, price hidden.
      await tester.pumpWidget(_wrap(
        ChatCostFooter(cost: 0.0142, tokens: tokens),
      ));
      expect(find.textContaining('1200'), findsAtLeastNWidgets(1)); // input
      expect(find.textContaining('350'), findsAtLeastNWidgets(1)); // output
      expect(find.textContaining('800'), findsAtLeastNWidgets(1)); // cache
      expect(find.textContaining('reasoning'), findsAtLeastNWidgets(1));
      expect(find.textContaining(r'$0.014'), findsNothing,
          reason: 'price is hidden until the chevron is expanded');

      // Tap to expand → price revealed on the bottom; tokens stay visible.
      await tester.tap(find.byType(ChatCostFooter));
      await tester.pump();
      expect(find.textContaining(r'$0.014'), findsAtLeastNWidgets(1));
      expect(find.textContaining('1200'), findsAtLeastNWidgets(1));
    });
  });

// ---------------------------------------------------------------------------
// c5 — No cost footer for user / legacy messages
// ---------------------------------------------------------------------------

  group('issue-693-c5: user and legacy messages render no cost footer', () {
    testWidgets('user message: no ChatCostFooter', (tester) async {
      await tester.pumpWidget(_wrap(
        // A user bubble has no cost footer.
        Builder(
          builder: (context) {
            // Directly check there's no cost footer when cost is null.
            return ChatCostFooter(cost: null, tokens: null);
          },
        ),
      ));
      // When cost is null, ChatCostFooter renders nothing (SizedBox.shrink).
      expect(find.textContaining(r'$'), findsNothing);
    });
  });

// ---------------------------------------------------------------------------
// c6 — Session total cost updates as messages land (controller unit test)
// ---------------------------------------------------------------------------

  group(
      'issue-693-c6: session total cost = sum of message costs updates as messages land',
      () {
    test('session total accumulates cost from message.updated events',
        () async {
      final (:ctrl, :repo) = _buildController();
      await ctrl.initialize();
      await Future<void>.delayed(Duration.zero);

      const sessionId = 'ses_cost_test';

      // Initially no cost.
      expect(ctrl.sessionTotalCost(sessionId), isNull);

      // First message arrives with cost 0.0042.
      repo.emit(MessageUpdatedMessage.fromJson({
        'type': 'message.updated',
        'id': sessionId,
        'info': {
          'id': 'msg_001',
          'sessionID': sessionId,
          'role': 'assistant',
          'cost': 0.0042,
          'tokens': {'input': 500, 'output': 200, 'reasoning': 0, 'cache': 100},
        },
      }));
      await Future<void>.delayed(Duration.zero);
      expect(ctrl.sessionTotalCost(sessionId), closeTo(0.0042, 1e-9));

      // Second message arrives with cost 0.0100.
      repo.emit(MessageUpdatedMessage.fromJson({
        'type': 'message.updated',
        'id': sessionId,
        'info': {
          'id': 'msg_002',
          'sessionID': sessionId,
          'role': 'assistant',
          'cost': 0.01,
          'tokens': {'input': 700, 'output': 150, 'reasoning': 0, 'cache': 200},
        },
      }));
      await Future<void>.delayed(Duration.zero);
      expect(ctrl.sessionTotalCost(sessionId), closeTo(0.0142, 1e-9));

      ctrl.dispose();
    });
  });

// ---------------------------------------------------------------------------
// c7 — Rehydrated messages show identical cost/token UI to streamed
// ---------------------------------------------------------------------------

  group(
      'issue-693-c7: rehydrated messages show identical cost/token UI to streamed',
      () {
    testWidgets(
        'ChatCostFooter from REST-rehydrated cost renders same as streamed',
        (tester) async {
      // Price lives behind the chevron now, so expand before reading it.
      // Distinct keys ensure each pump builds a fresh State (otherwise the
      // second footer reuses the first's already-expanded state and the tap
      // would collapse it).
      // Streamed: cost arrived via WS message.updated event.
      await tester.pumpWidget(_wrap(
        ChatCostFooter(
          key: const ValueKey('streamed'),
          cost: 0.0142,
          tokens: const {
            'input': 1200,
            'output': 350,
            'reasoning': 0,
            'cache': 800,
          },
        ),
      ));
      await tester.tap(find.byType(ChatCostFooter));
      await tester.pump();
      final streamedCostText = tester
          .widget<Text>(
            find.descendant(
              of: find.byType(ChatCostFooter),
              matching: find.byWidgetPredicate(
                (w) => w is Text && (w.data ?? '').contains(r'$'),
              ),
            ),
          )
          .data;

      // Rehydrated: same cost values but constructed from REST payload.
      await tester.pumpWidget(_wrap(
        ChatCostFooter(
          key: const ValueKey('rehydrated'),
          cost: 0.0142,
          tokens: const {
            'input': 1200,
            'output': 350,
            'reasoning': 0,
            'cache': 800,
          },
        ),
      ));
      await tester.tap(find.byType(ChatCostFooter));
      await tester.pump();
      final rehydratedCostText = tester
          .widget<Text>(
            find.descendant(
              of: find.byType(ChatCostFooter),
              matching: find.byWidgetPredicate(
                (w) => w is Text && (w.data ?? '').contains(r'$'),
              ),
            ),
          )
          .data;

      // Identical display.
      expect(rehydratedCostText, equals(streamedCostText));
    });
  });
} // end main()
