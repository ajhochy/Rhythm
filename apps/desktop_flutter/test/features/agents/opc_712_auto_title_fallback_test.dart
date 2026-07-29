/// Acceptance contract for OPC-#712 — client-side auto-title fallback.
///
/// When a session has no server title after the first user turn, `sendInput`
/// must derive a display name from the first ~40 chars of the message and
/// update the session in `_sessions` immediately (before session.updated
/// arrives from the server).
///
/// When `session.updated` later carries a non-empty title from the server,
/// the SessionUpdatedMessage handler must replace the fallback title —
/// the server title always wins.
///
/// Acceptance criteria:
///   c1 — first sendInput on a nameless session sets fallback title.
///   c2 — message > 40 chars is truncated with '…'.
///   c3 — second sendInput does NOT change an already-named session.
///   c4 — SessionUpdatedMessage with real title replaces the fallback.
///   c5 — session already named 'My Project' is not overwritten.
import 'dart:async';

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
// Fakes / stubs
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

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository(this._sessions);

  final List<AgentSession> _sessions;

  final StreamController<AgentWsMessage> _msg = StreamController.broadcast();
  final StreamController<bool> _conn = StreamController.broadcast();

  void emit(AgentWsMessage m) => _msg.add(m);

  @override
  Stream<AgentWsMessage> get messages => _msg.stream;

  @override
  Stream<bool> get connectivityStream => _conn.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msg.close();
    await _conn.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async => _sessions;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
  getSession(String id) async {
    final s = _sessions.firstWhere((x) => x.id == id);
    return (session: s, messages: const <AgentSessionMessage>[]);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

AgentSession _session(String id, {String name = ''}) {
  final now = DateTime.now();
  return AgentSession(
    id: id,
    agentId: 'claude-code',
    status: AgentSessionStatus.idle,
    cwd: '/tmp',
    name: name,
    createdAt: now,
    updatedAt: now,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('OPC-#712 auto-title fallback', () {
    // -----------------------------------------------------------------------
    // c1 — first sendInput on a nameless session sets fallback title
    // -----------------------------------------------------------------------
    test(
      'c1: first sendInput sets fallback title when session name is empty',
      () async {
        final session = _session('s1', name: '');
        final repo = _StubAgentsRepository([session]);
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        // Confirm precondition: session is loaded with empty name.
        expect(controller.sessions.first.name, equals(''));

        // Act: send the first user message.
        controller.sendInput('s1', 'Fix the login bug\n');

        // Assert: session name is now derived from the message text.
        final updated = controller.sessions.firstWhere((s) => s.id == 's1');
        expect(updated.name, equals('Fix the login bug'));
      },
    );

    // -----------------------------------------------------------------------
    // c2 — message > 40 chars is truncated with '…'
    // -----------------------------------------------------------------------
    test(
      'c2: message longer than 40 chars is truncated with ellipsis',
      () async {
        final session = _session('s2', name: '');
        final repo = _StubAgentsRepository([session]);
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        const longMessage =
            'Refactor the entire authentication system to use OAuth 2.0\n';
        controller.sendInput('s2', longMessage);

        final updated = controller.sessions.firstWhere((s) => s.id == 's2');
        // Fallback title should be at most 40 chars + '…'.
        expect(updated.name.length, lessThanOrEqualTo(41));
        expect(updated.name, endsWith('…'));
        expect(
          updated.name,
          startsWith('Refactor the entire authentication syste'),
        );
      },
    );

    // -----------------------------------------------------------------------
    // c3 — second sendInput does NOT change an already-named session
    // -----------------------------------------------------------------------
    test(
      'c3: second sendInput does not overwrite the fallback title',
      () async {
        final session = _session('s3', name: '');
        final repo = _StubAgentsRepository([session]);
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        controller.sendInput('s3', 'First message\n');
        final afterFirst = controller.sessions
            .firstWhere((s) => s.id == 's3')
            .name;
        expect(afterFirst, equals('First message'));

        // Simulate a second user turn (chatMessages now has 2 entries).
        controller.sendInput('s3', 'Second message\n');

        final afterSecond = controller.sessions
            .firstWhere((s) => s.id == 's3')
            .name;
        // Name must be unchanged from the first-turn fallback.
        expect(afterSecond, equals('First message'));
      },
    );

    // -----------------------------------------------------------------------
    // c4 — SessionUpdatedMessage with real title replaces the fallback
    // -----------------------------------------------------------------------
    test(
      'c4: SessionUpdatedMessage with server title replaces the fallback',
      () async {
        final session = _session('s4', name: '');
        final repo = _StubAgentsRepository([session]);
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        // Set fallback title via first sendInput.
        controller.sendInput('s4', 'Some prompt\n');
        expect(
          controller.sessions.firstWhere((s) => s.id == 's4').name,
          equals('Some prompt'),
        );

        // Simulate server-side session.updated carrying the auto-generated title.
        final serverUpdated = _session('s4', name: 'Server Generated Title');
        repo.emit(SessionUpdatedMessage(session: serverUpdated));

        // Allow the WS event to propagate.
        await Future<void>.delayed(Duration.zero);

        final afterServerUpdate = controller.sessions
            .firstWhere((s) => s.id == 's4')
            .name;
        expect(afterServerUpdate, equals('Server Generated Title'));
      },
    );

    // -----------------------------------------------------------------------
    // c5 — session already named 'My Project' is not overwritten
    // -----------------------------------------------------------------------
    test(
      'c5: sendInput does not overwrite a session that already has a name',
      () async {
        final session = _session('s5', name: 'My Project');
        final repo = _StubAgentsRepository([session]);
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        controller.sendInput('s5', 'Do the thing\n');

        final updated = controller.sessions.firstWhere((s) => s.id == 's5');
        expect(updated.name, equals('My Project'));
      },
    );
  });
}
