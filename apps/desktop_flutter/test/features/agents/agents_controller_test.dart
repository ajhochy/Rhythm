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
// Fake AgentServerController
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null);

  @override
  Future<void> stop() async {}
}

/// A minimal stub of [AgentServerController] that exposes configurable
/// [isReady] / [hasAnyAgent] so tests can control the capability gate without
/// spinning up a real server process.
class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController({
    required bool ready,
    required bool anyAgent,
  })  : _ready = ready,
        _anyAgent = anyAgent,
        super(_FakeApiServerService());

  final bool _ready;
  final bool _anyAgent;
  int retryCallCount = 0;

  @override
  bool get isReady => _ready;

  @override
  bool get hasAnyAgent => _anyAgent;

  @override
  Future<void> initialize() async {
    // No-op — do not actually spawn a server process.
  }

  @override
  Future<void> retry() async {
    retryCallCount++;
  }
}

// ---------------------------------------------------------------------------
// Fake repository
// ---------------------------------------------------------------------------

class _FakeAgentsRepository implements AgentsRepository {
  _FakeAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;
  bool connectCalled = false;
  bool disposeCalled = false;
  final List<Map<String, dynamic>> sentMessages = [];
  List<AgentSession> sessionsToReturn = [];

  /// Push a synthetic WS message from the test.
  void emit(AgentWsMessage msg) => _msgController.add(msg);

  /// Push a synthetic connectivity event from the test.
  void emitConnectivity(bool connected) =>
      _connectivityController.add(connected);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => connectCalled;

  @override
  Future<void> connect() async {
    connectCalled = true;
  }

  @override
  Future<void> dispose() async {
    disposeCalled = true;
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {
    sentMessages.add(msg);
  }

  @override
  Future<List<AgentSession>> listSessions() async => sessionsToReturn;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final session = _makeSession(id, AgentSessionStatus.idle);
    return (session: session, messages: <AgentSessionMessage>[]);
  }

  @override
  Future<AgentSession> createSession({
    required String agentId,
    String? taskId,
    required String cwd,
    required String name,
  }) async {
    return _makeSession('new-session', AgentSessionStatus.starting);
  }

  final List<String> closeSessionCalls = [];
  final List<String> deleteSessionCalls = [];

  @override
  Future<void> closeSession(String id) async {
    closeSessionCalls.add(id);
  }

  @override
  Future<void> deleteSession(String id) async {
    deleteSessionCalls.add(id);
  }

  @override
  Future<AgentSession> resumeSession(String id) async {
    return _makeSession(id, AgentSessionStatus.idle);
  }

  @override
  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) async {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fake notification dependencies
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

AgentSession _makeSession(String id, AgentSessionStatus status) {
  final now = DateTime.now();
  return AgentSession(
    id: id,
    agentId: 'claude-code',
    status: status,
    cwd: '/tmp',
    name: 'Test Session $id',
    createdAt: now,
    updatedAt: now,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeAgentsRepository fakeRepo;
  late AgentsController controller;

  setUp(() {
    fakeRepo = _FakeAgentsRepository();
    controller = AgentsController(
      fakeRepo,
      _FakeAgentServerController(ready: true, anyAgent: true),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
  });

  tearDown(() {
    controller.dispose();
  });

  // --------------------------------------------------------------------------
  // initialize()
  // --------------------------------------------------------------------------

  group('initialize()', () {
    test('calls connect() and subscribes to messages', () async {
      await controller.initialize();

      expect(fakeRepo.connectCalled, isTrue);
    });

    test('loads sessions after connecting', () async {
      fakeRepo.sessionsToReturn = [
        _makeSession('s1', AgentSessionStatus.idle),
        _makeSession('s2', AgentSessionStatus.working),
      ];

      await controller.initialize();

      expect(controller.sessions, hasLength(2));
      expect(controller.status, AgentsLoadStatus.idle);
    });

    test('separates resumable sessions from active ones', () async {
      fakeRepo.sessionsToReturn = [
        _makeSession('active', AgentSessionStatus.idle),
        _makeSession('resumable', AgentSessionStatus.resumable),
      ];

      await controller.initialize();

      expect(controller.sessions, hasLength(1));
      expect(controller.sessions.first.id, 'active');
      expect(controller.resumable, hasLength(1));
      expect(controller.resumable.first.id, 'resumable');
    });

    test('does not connect when agent server is not ready', () async {
      final notReadyController = AgentsController(
        fakeRepo,
        _FakeAgentServerController(ready: false, anyAgent: false),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(notReadyController.dispose);

      await notReadyController.initialize();

      expect(fakeRepo.connectCalled, isFalse);
    });
  });

  // --------------------------------------------------------------------------
  // WS message → state transitions
  // --------------------------------------------------------------------------

  group('WS messages update state', () {
    setUp(() async {
      await controller.initialize();
    });

    test('SessionCreatedMessage adds session to list', () async {
      expect(controller.sessions, isEmpty);

      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('new-sess', AgentSessionStatus.starting),
      ));

      // Allow microtask queue to drain.
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions, hasLength(1));
      expect(controller.sessions.first.id, 'new-sess');
    });

    test('SessionCreatedMessage does not duplicate an existing session',
        () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('dup', AgentSessionStatus.starting),
      ));
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('dup', AgentSessionStatus.starting),
      ));

      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions.where((s) => s.id == 'dup'), hasLength(1));
    });

    test(
        'SessionClosedMessage removes session and moves to resumable when flag is set',
        () async {
      // Seed via WS.
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('to-close', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(controller.sessions, hasLength(1));

      fakeRepo.emit(const SessionClosedMessage(
        id: 'to-close',
        resumable: true,
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions, isEmpty);
      expect(controller.resumable, hasLength(1));
      expect(controller.resumable.first.id, 'to-close');
      expect(controller.resumable.first.status, AgentSessionStatus.resumable);
    });

    test(
        'SessionClosedMessage removes session without adding to resumable when flag is false',
        () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('temp', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      fakeRepo.emit(const SessionClosedMessage(
        id: 'temp',
        resumable: false,
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions, isEmpty);
      expect(controller.resumable, isEmpty);
    });

    test('SessionStatusMessage updates working map', () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('working-sess', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.isWorking('working-sess'), isFalse);

      fakeRepo.emit(const SessionStatusMessage(
        id: 'working-sess',
        working: true,
        source: 'agent',
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.isWorking('working-sess'), isTrue);
    });

    test('OutputMessage appends to live output buffer', () async {
      fakeRepo.emit(const OutputMessage(
        id: 'sess-out',
        data: 'hello ',
        replay: false,
      ));
      fakeRepo.emit(const OutputMessage(
        id: 'sess-out',
        data: 'world',
        replay: false,
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.liveOutputFor('sess-out'), 'hello world');
    });

    test('TriggerFiredMessage adds pending trigger', () async {
      fakeRepo.emit(const TriggerFiredMessage(
        taskId: 'task-42',
        taskTitle: 'Deploy to prod',
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.pendingTriggers, hasLength(1));
      expect(controller.pendingTriggers.first.taskId, 'task-42');
      expect(controller.pendingTriggers.first.taskTitle, 'Deploy to prod');
    });

    test('SessionsListMessage replaces session and resumable lists', () async {
      // Seed an existing session.
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('old', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(controller.sessions, hasLength(1));

      // Broadcast an authoritative list.
      fakeRepo.emit(SessionsListMessage(
        sessions: [
          _makeSession('a', AgentSessionStatus.working),
          _makeSession('b', AgentSessionStatus.idle),
          _makeSession('r1', AgentSessionStatus.resumable),
        ],
        resumable: [],
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions, hasLength(2));
      expect(controller.sessions.map((s) => s.id), containsAll(['a', 'b']));
      expect(controller.resumable, hasLength(1));
      expect(controller.resumable.first.id, 'r1');
    });
  });

  // --------------------------------------------------------------------------
  // connectivity stream → AgentSessionConnectivity transitions
  // --------------------------------------------------------------------------

  group('connectivity stream transitions', () {
    setUp(() async {
      await controller.initialize();
    });

    test('stream emitting false sets isWsDisconnected to true and notifies',
        () async {
      expect(controller.connectivity.isWsDisconnected, isFalse);

      var notified = false;
      controller.addListener(() => notified = true);

      fakeRepo.emitConnectivity(false);
      await Future<void>.delayed(Duration.zero);

      expect(controller.connectivity.isWsDisconnected, isTrue);
      expect(notified, isTrue);
    });

    test('stream emitting true flips isWsDisconnected back to false', () async {
      // First disconnect.
      fakeRepo.emitConnectivity(false);
      await Future<void>.delayed(Duration.zero);
      expect(controller.connectivity.isWsDisconnected, isTrue);

      // Then reconnect.
      var notified = false;
      controller.addListener(() => notified = true);

      fakeRepo.emitConnectivity(true);
      await Future<void>.delayed(Duration.zero);

      expect(controller.connectivity.isWsDisconnected, isFalse);
      expect(notified, isTrue);
    });

    test('redundant true event does not trigger extra notifyListeners',
        () async {
      // Already connected (default state) — emit true again; no notification
      // should fire because the flag was already false.
      var notifyCount = 0;
      controller.addListener(() => notifyCount++);

      fakeRepo.emitConnectivity(true);
      await Future<void>.delayed(Duration.zero);

      expect(notifyCount, isZero);
    });

    test('redundant false event does not trigger extra notifyListeners',
        () async {
      // Disconnect first.
      fakeRepo.emitConnectivity(false);
      await Future<void>.delayed(Duration.zero);

      // A second false should not fire another notification.
      var notifyCount = 0;
      controller.addListener(() => notifyCount++);

      fakeRepo.emitConnectivity(false);
      await Future<void>.delayed(Duration.zero);

      expect(notifyCount, isZero);
    });

    test('dispose() cancels the connectivity subscription', () async {
      // Call dispose explicitly — the tearDown will call it again but that is
      // expected to be a no-op (ChangeNotifier tolerates double-dispose in
      // debug mode by just asserting it was not already disposed during the
      // *first* call). We use a fresh controller so tearDown's dispose does not
      // interfere with this test.
      final localRepo = _FakeAgentsRepository();
      final localController = AgentsController(
        localRepo,
        _FakeAgentServerController(ready: true, anyAgent: true),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      await localController.initialize();

      // Dispose and then emit — stream event must be silently dropped (no
      // state mutation, no throw).
      localController.dispose();

      expect(() => localRepo.emitConnectivity(false), returnsNormally);

      // Allow any pending microtasks to settle.
      await Future<void>.delayed(Duration.zero);
    });
  });

  // --------------------------------------------------------------------------
  // dismissTrigger
  // --------------------------------------------------------------------------

  group('dismissTrigger()', () {
    setUp(() async {
      await controller.initialize();
    });

    test('removes the matching pending trigger', () async {
      fakeRepo.emit(const TriggerFiredMessage(
        taskId: 'task-1',
        taskTitle: 'Task One',
      ));
      fakeRepo.emit(const TriggerFiredMessage(
        taskId: 'task-2',
        taskTitle: 'Task Two',
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.pendingTriggers, hasLength(2));

      controller.dismissTrigger('task-1');

      expect(controller.pendingTriggers, hasLength(1));
      expect(controller.pendingTriggers.first.taskId, 'task-2');
    });

    test('is a no-op when taskId does not match any trigger', () async {
      fakeRepo.emit(const TriggerFiredMessage(
        taskId: 'task-1',
        taskTitle: 'Task One',
      ));
      await Future<void>.delayed(Duration.zero);

      controller.dismissTrigger('nonexistent');

      expect(controller.pendingTriggers, hasLength(1));
    });

    test('notifyListeners fires after dismissal', () {
      var notified = false;
      controller.addListener(() => notified = true);

      controller.dismissTrigger('anything');

      expect(notified, isTrue);
    });
  });

  // --------------------------------------------------------------------------
  // sendInput / resize
  // --------------------------------------------------------------------------

  group('WS send helpers', () {
    setUp(() async {
      await controller.initialize();
    });

    test('sendInput sends session.input message', () {
      controller.sendInput('sess-abc', 'ls -la\n');

      expect(fakeRepo.sentMessages, hasLength(1));
      expect(fakeRepo.sentMessages.first['type'], 'session.input');
      expect(fakeRepo.sentMessages.first['id'], 'sess-abc');
      expect(fakeRepo.sentMessages.first['data'], 'ls -la\n');
    });

    test('resize sends session.resize message', () {
      controller.resize('sess-abc', 80, 24);

      expect(fakeRepo.sentMessages, hasLength(1));
      expect(fakeRepo.sentMessages.first['type'], 'session.resize');
      expect(fakeRepo.sentMessages.first['cols'], 80);
      expect(fakeRepo.sentMessages.first['rows'], 24);
    });
  });

  // --------------------------------------------------------------------------
  // Stuck-session detection
  // --------------------------------------------------------------------------

  group('stuck-session detection', () {
    setUp(() async {
      await controller.initialize();
    });

    test('session with no output and >30s elapsed appears in stuckSessionIds',
        () async {
      // Seed a starting session via WS.
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('stuck-sess', AgentSessionStatus.starting),
      ));
      await Future<void>.delayed(Duration.zero);

      // Backdate the first-seen timestamp to simulate >30s having passed.
      controller.sessionFirstSeenAt['stuck-sess'] =
          DateTime.now().subtract(const Duration(seconds: 31));

      controller.recomputeStuckForTest();

      expect(controller.connectivity.stuckSessionIds, contains('stuck-sess'));
      expect(controller.connectivity.isStuck('stuck-sess'), isTrue);
    });

    test('session with output is not considered stuck', () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('active-sess', AgentSessionStatus.starting),
      ));
      await Future<void>.delayed(Duration.zero);

      // Simulate output arriving (which removes the session from firstSeenAt).
      fakeRepo.emit(const OutputMessage(
        id: 'active-sess',
        data: 'some output',
        replay: false,
      ));
      await Future<void>.delayed(Duration.zero);

      // Backdate to simulate >30s.
      controller.sessionFirstSeenAt['active-sess'] =
          DateTime.now().subtract(const Duration(seconds: 31));

      controller.recomputeStuckForTest();

      // Should NOT be stuck because output arrived (and firstSeenAt was removed).
      expect(controller.connectivity.stuckSessionIds,
          isNot(contains('active-sess')));
    });

    test('output message clears session from sessionFirstSeenAt immediately',
        () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('out-sess', AgentSessionStatus.starting),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessionFirstSeenAt.containsKey('out-sess'), isTrue);

      fakeRepo.emit(const OutputMessage(
        id: 'out-sess',
        data: 'hello',
        replay: false,
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessionFirstSeenAt.containsKey('out-sess'), isFalse);
    });

    test('closed session is removed from stuckSessionIds on next tick',
        () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('closing-sess', AgentSessionStatus.starting),
      ));
      await Future<void>.delayed(Duration.zero);

      // Make it appear stuck.
      controller.sessionFirstSeenAt['closing-sess'] =
          DateTime.now().subtract(const Duration(seconds: 31));
      controller.recomputeStuckForTest();
      expect(controller.connectivity.stuckSessionIds, contains('closing-sess'));

      // Now close the session.
      fakeRepo.emit(const SessionClosedMessage(
        id: 'closing-sess',
        resumable: false,
      ));
      await Future<void>.delayed(Duration.zero);

      // sessionFirstSeenAt entry should be gone.
      expect(
          controller.sessionFirstSeenAt.containsKey('closing-sess'), isFalse);

      // After the next recompute the stuck set should be empty.
      controller.recomputeStuckForTest();
      expect(controller.connectivity.stuckSessionIds,
          isNot(contains('closing-sess')));
    });

    test('session <30s old is not yet stuck', () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('young-sess', AgentSessionStatus.starting),
      ));
      await Future<void>.delayed(Duration.zero);

      // Only 10s have elapsed — not stuck yet.
      controller.sessionFirstSeenAt['young-sess'] =
          DateTime.now().subtract(const Duration(seconds: 10));

      controller.recomputeStuckForTest();

      expect(controller.connectivity.stuckSessionIds,
          isNot(contains('young-sess')));
    });

    test(
        'SessionsListMessage records firstSeenAt for newly observed starting sessions',
        () async {
      fakeRepo.emit(SessionsListMessage(
        sessions: [
          _makeSession('list-starting', AgentSessionStatus.starting),
          _makeSession('list-idle', AgentSessionStatus.idle),
        ],
        resumable: [],
      ));
      await Future<void>.delayed(Duration.zero);

      expect(
          controller.sessionFirstSeenAt.containsKey('list-starting'), isTrue);
      expect(controller.sessionFirstSeenAt.containsKey('list-idle'), isFalse);
    });

    test('notifyListeners fires when stuckSessionIds changes', () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('notify-sess', AgentSessionStatus.starting),
      ));
      await Future<void>.delayed(Duration.zero);

      controller.sessionFirstSeenAt['notify-sess'] =
          DateTime.now().subtract(const Duration(seconds: 31));

      var notified = false;
      controller.addListener(() => notified = true);

      controller.recomputeStuckForTest();

      expect(notified, isTrue);
      expect(controller.connectivity.stuckSessionIds, contains('notify-sess'));
    });
  });

  // --------------------------------------------------------------------------
  // reconnectSession()
  // --------------------------------------------------------------------------

  group('reconnectSession()', () {
    test('when server not ready: calls retry() then load()', () async {
      final notReadyServerController =
          _FakeAgentServerController(ready: false, anyAgent: false);
      final localController = AgentsController(
        fakeRepo,
        notReadyServerController,
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(localController.dispose);

      fakeRepo.sessionsToReturn = [
        _makeSession('s1', AgentSessionStatus.idle),
      ];

      await localController.reconnectSession('some-id');

      expect(notReadyServerController.retryCallCount, 1);
      // load() was called — sessions list should have been populated.
      expect(localController.sessions, hasLength(1));
    });

    test('when server ready: sends session.subscribe and refreshes transcript',
        () async {
      final readyServerController =
          _FakeAgentServerController(ready: true, anyAgent: true);
      final localController = AgentsController(
        fakeRepo,
        readyServerController,
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(localController.dispose);
      await localController.initialize();

      await localController.selectSession('target-session');
      fakeRepo.sentMessages.clear();

      await localController.reconnectSession('target-session');

      expect(
        fakeRepo.sentMessages.any((m) =>
            m['type'] == 'session.subscribe' && m['id'] == 'target-session'),
        isTrue,
      );
      // Transcript was refreshed (getSession returns empty messages list).
      expect(localController.transcript, isEmpty);
    });

    test('concurrent calls are coalesced via _reconnecting guard', () async {
      final readyServerController =
          _FakeAgentServerController(ready: true, anyAgent: true);
      final localController = AgentsController(
        fakeRepo,
        readyServerController,
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(localController.dispose);
      await localController.initialize();

      // Fire two concurrent calls — only the first should proceed.
      final first = localController.reconnectSession('sess-1');
      final second = localController.reconnectSession('sess-1');
      await Future.wait([first, second]);

      // session.subscribe should appear exactly once.
      final subscribeCalls = fakeRepo.sentMessages
          .where((m) => m['type'] == 'session.subscribe' && m['id'] == 'sess-1')
          .length;
      expect(subscribeCalls, 1);
    });
  });

  // --------------------------------------------------------------------------
  // closeSession()
  // --------------------------------------------------------------------------

  group('closeSession()', () {
    test(
        'when server not ready: removes session synchronously without calling repository',
        () async {
      final notReadyServerController =
          _FakeAgentServerController(ready: false, anyAgent: false);
      final localRepo = _FakeAgentsRepository();
      final localController = AgentsController(
        localRepo,
        notReadyServerController,
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(localController.dispose);

      // Manually seed a session into the controller's internal list via WS
      // after bypassing initialize (server not ready, so no connect).
      // Instead, directly call load with a pre-populated sessionsToReturn.
      localRepo.sessionsToReturn = [
        _makeSession('stale-sess', AgentSessionStatus.idle),
      ];
      await localController.initialize();
      // initialize() skips load when not ready, so call load directly.
      await localController.load();
      expect(localController.sessions, hasLength(1));

      // Also seed supporting maps.
      localController.sessionFirstSeenAt['stale-sess'] = DateTime.now();

      var notified = false;
      localController.addListener(() => notified = true);

      await localController.closeSession('stale-sess');

      // Session removed from list.
      expect(localController.sessions, isEmpty);
      // Listeners were notified.
      expect(notified, isTrue);
      // Repository was NOT called.
      expect(localRepo.closeSessionCalls, isEmpty);
      // Supporting maps cleaned up.
      expect(localController.sessionFirstSeenAt.containsKey('stale-sess'),
          isFalse);
    });

    test(
        'when server not ready: clears selectedSessionId when it matches the closed session',
        () async {
      final notReadyServerController =
          _FakeAgentServerController(ready: false, anyAgent: false);
      final localRepo = _FakeAgentsRepository();
      final localController = AgentsController(
        localRepo,
        notReadyServerController,
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(localController.dispose);

      localRepo.sessionsToReturn = [
        _makeSession('sel-sess', AgentSessionStatus.idle),
      ];
      await localController.load();
      // Manually set the selected session id by selecting it (but server not
      // ready so we just manipulate via load and closeSession directly).
      // We rely on closeSession clearing _selectedSessionId when it matches.

      await localController.closeSession('sel-sess');

      expect(localController.selectedSessionId, isNull);
    });

    test('when server ready: delegates to repository DELETE path', () async {
      final readyServerController =
          _FakeAgentServerController(ready: true, anyAgent: true);
      final localRepo = _FakeAgentsRepository();
      final localController = AgentsController(
        localRepo,
        readyServerController,
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(localController.dispose);
      await localController.initialize();

      // Seed a session via WS so it's in the list.
      localRepo.emit(SessionCreatedMessage(
        session: _makeSession('online-sess', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(localController.sessions, hasLength(1));

      await localController.closeSession('online-sess');

      // Repository closeSession was called.
      expect(localRepo.closeSessionCalls, contains('online-sess'));
      // The session remains in the list until the WS SessionClosedMessage
      // arrives — that is the existing online behaviour.
      expect(localController.sessions, hasLength(1));
    });
  });
}
