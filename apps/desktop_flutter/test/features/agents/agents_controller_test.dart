import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';

// ---------------------------------------------------------------------------
// Fake AgentServerController
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<bool> start() async => true;

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

  @override
  bool get isReady => _ready;

  @override
  bool get hasAnyAgent => _anyAgent;

  @override
  Future<void> initialize() async {
    // No-op — do not actually spawn a server process.
  }
}

// ---------------------------------------------------------------------------
// Fake repository
// ---------------------------------------------------------------------------

class _FakeAgentsRepository implements AgentsRepository {
  _FakeAgentsRepository() : _msgController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  bool connectCalled = false;
  bool disposeCalled = false;
  final List<Map<String, dynamic>> sentMessages = [];
  List<AgentSession> sessionsToReturn = [];

  /// Push a synthetic WS message from the test.
  void emit(AgentWsMessage msg) => _msgController.add(msg);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

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
    required AgentKind agentKind,
    String? taskId,
    required String cwd,
    required String name,
  }) async {
    return _makeSession('new-session', AgentSessionStatus.starting);
  }

  @override
  Future<void> closeSession(String id) async {}

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
// Helpers
// ---------------------------------------------------------------------------

AgentSession _makeSession(String id, AgentSessionStatus status) {
  final now = DateTime.now();
  return AgentSession(
    id: id,
    agentKind: AgentKind.claudeCode,
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
  late _FakeAgentsRepository fakeRepo;
  late AgentsController controller;

  setUp(() {
    fakeRepo = _FakeAgentsRepository();
    controller = AgentsController(
      fakeRepo,
      _FakeAgentServerController(ready: true, anyAgent: true),
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
}
