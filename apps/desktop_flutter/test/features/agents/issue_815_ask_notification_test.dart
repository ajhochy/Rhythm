// Issue #815 — native macOS notification on agent question/permission asks.
//
// These tests exercise the *decision* logic (should-notify predicate, dedupe,
// withdraw-on-resolve) and assert the notification-service platform call is
// invoked with a routing payload. Native OS banner delivery itself is not
// unit-testable and is covered by the manual-smoke step.

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
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
  Future<void> stop() async {}
}

class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController() : super(_FakeApiServerService());

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;

  @override
  Future<void> initialize() async {}
}

/// Records the show/cancel calls so tests can assert the decision logic.
class _SpyNotificationService extends LocalNotificationService {
  final List<({int id, String title, String body, String payload})> shown = [];
  final List<int> cancelled = [];

  @override
  Future<void> showAgentAskNotification({
    required int id,
    required String title,
    required String body,
    required String payload,
  }) async {
    shown.add((id: id, title: title, body: body, payload: payload));
  }

  @override
  Future<void> cancel(int id) async {
    cancelled.add(id);
  }
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

class _FakeAgentsRepository implements AgentsRepository {
  _FakeAgentsRepository() : _msgController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final _connectivity = StreamController<bool>.broadcast();

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivity.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivity.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final now = DateTime.now();
    return (
      session: AgentSession(
        id: id,
        agentId: 'claude-code',
        status: AgentSessionStatus.idle,
        cwd: '/tmp',
        name: 'Session $id',
        createdAt: now,
        updatedAt: now,
      ),
      messages: <AgentSessionMessage>[],
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _SpyNotificationService spy;
  late AgentsController controller;

  setUp(() {
    spy = _SpyNotificationService();
    controller = AgentsController(
      _FakeAgentsRepository(),
      _FakeAgentServerController(),
      spy,
      _FakeNotificationsController(),
    );
    // Default to backgrounded so most cases fire unless told otherwise.
    controller.didChangeAppLifecycleState(AppLifecycleState.inactive);
  });

  PermissionAskedMessage perm(String sessionId, String permissionId) =>
      PermissionAskedMessage(
        sessionId: sessionId,
        permissionId: permissionId,
        toolName: 'write',
        args: const {},
        summary: 'Write to config.yaml',
      );

  QuestionAskedMessage question(String sessionId, String requestId) =>
      QuestionAskedMessage(
        sessionId: sessionId,
        requestId: requestId,
        callId: 'call_$requestId',
        questions: const [
          {'question': 'Which environment should I deploy to?'}
        ],
      );

  group('shouldNotifyAsk predicate (#815)', () {
    test('notifies when the app is backgrounded, even if session selected',
        () async {
      await controller.selectSession('s1');
      controller.didChangeAppLifecycleState(AppLifecycleState.inactive);
      expect(controller.shouldNotifyAsk('s1'), isTrue);
    });

    test('notifies when frontmost but a different session is selected',
        () async {
      await controller.selectSession('other');
      controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      expect(controller.shouldNotifyAsk('s1'), isTrue);
    });

    test('suppresses when frontmost AND viewing the asking session', () async {
      await controller.selectSession('s1');
      controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      expect(controller.shouldNotifyAsk('s1'), isFalse);
    });
  });

  group('permission asks (#815)', () {
    test('fires a notification with title/body/payload when backgrounded', () {
      controller.handleWsMessageForTest(perm('s1', 'p1'));
      expect(spy.shown, hasLength(1));
      final n = spy.shown.single;
      expect(n.title, contains('Permission requested'));
      expect(n.body, contains('Write to config.yaml'));
      expect(n.payload, 'agentSession:s1');
    });

    test('does not fire while viewing the asking session', () async {
      await controller.selectSession('s1');
      controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      controller.handleWsMessageForTest(perm('s1', 'p1'));
      expect(spy.shown, isEmpty);
    });

    test('dedupes repeated asks for the same permission', () {
      controller.handleWsMessageForTest(perm('s1', 'p1'));
      controller.handleWsMessageForTest(perm('s1', 'p1'));
      expect(spy.shown, hasLength(1));
    });

    test('withdraws the notification when the permission resolves', () {
      controller.handleWsMessageForTest(perm('s1', 'p1'));
      final shownId = spy.shown.single.id;
      controller.handleWsMessageForTest(
        const PermissionResolvedMessage(
          sessionId: 's1',
          permissionId: 'p1',
          decision: 'accept',
        ),
      );
      expect(spy.cancelled, contains(shownId));
    });
  });

  group('question asks (#815)', () {
    test('fires a notification carrying the question text', () {
      controller.handleWsMessageForTest(question('s2', 'q1'));
      expect(spy.shown, hasLength(1));
      final n = spy.shown.single;
      expect(n.title, contains('Question'));
      expect(n.body, contains('Which environment'));
      expect(n.payload, 'agentSession:s2');
    });

    test('dedupes repeated question.asked for the same requestId', () {
      controller.handleWsMessageForTest(question('s2', 'q1'));
      controller.handleWsMessageForTest(question('s2', 'q1'));
      expect(spy.shown, hasLength(1));
    });

    test('withdraws the notification when the question resolves', () {
      controller.handleWsMessageForTest(question('s2', 'q1'));
      final shownId = spy.shown.single.id;
      controller.handleWsMessageForTest(
        const QuestionResolvedMessage(
          sessionId: 's2',
          requestId: 'q1',
          rejected: false,
        ),
      );
      expect(spy.cancelled, contains(shownId));
    });
  });
}
