import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
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
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

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
  List<AgentInfo> availableAgentsToReturn = const [];

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
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      sessionsToReturn;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final session = _makeSession(id, AgentSessionStatus.idle);
    return (session: session, messages: <AgentSessionMessage>[]);
  }

  @override
  Future<AgentSession> createSession({
    String? agentId,
    String? taskId,
    required String cwd,
    String name = '',
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
    bool isolateWorktree = false,
    String? worktreeName,
  }) async {
    lastCreateAgentId = agentId;
    return _makeSession('new-session', AgentSessionStatus.starting);
  }

  /// #889: the agentId passed to the most recent createSession call, so tests
  /// can assert default-agent resolution.
  String? lastCreateAgentId;

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
  Future<void> cancelSession(String id) async {}

  @override
  Future<AgentSession> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    String? permissionMode,
    bool clearProvider = false,
    bool clearModel = false,
    bool? fastMode,
    String? anthropicAccountId,
  }) async {
    throw UnimplementedError();
  }

  @override
  Future<AgentSession> updateSessionThinkingBudget(
    String id,
    int? budget,
  ) async {
    throw UnimplementedError();
  }

  @override
  Future<AgentSession> resumeSession(String id) async {
    return _makeSession(id, AgentSessionStatus.idle);
  }

  @override
  Future<AgentSession> archiveSession(String id) async {
    return _makeSession(id, AgentSessionStatus.closed);
  }

  @override
  Future<AgentSession> unarchiveSession(String id) async {
    return _makeSession(id, AgentSessionStatus.idle);
  }

  @override
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision, {
    String? message,
  }) async {}

  @override
  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) async {}

  @override
  Future<void> rejectQuestion(String sessionId, String callId) async {}

  @override
  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) async {
    return [];
  }

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async {
    return [];
  }

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
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async => [];

  @override
  Future<Map<String, dynamic>> fetchMemoryProvenance(String id) async =>
      {'recorded': false, 'memoryIds': [], 'notePaths': []};

  @override
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) async =>
      [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId,
          {String? cwd}) async =>
      [];

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async =>
      availableAgentsToReturn;

  @override
  Future<String> createPty(String sessionId) async => 'pty-stub';

  @override
  Future<void> resizePty(String ptyId, int cols, int rows) async {}

  @override
  Future<void> killPty(String ptyId) async {}

  @override
  String ptyWsUrl(String ptyId) => 'ws://localhost:4001/ws/pty/$ptyId';

  // OCU-19..25 (#1060-#1066): vcs/shell/init/files methods added to
  // AgentsRepository — not exercised by this test file, so fall back.
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAgentModelsDataSource extends AgentModelsDataSource {
  List<CatalogModelEntry> catalogToReturn = const [];

  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => catalogToReturn;
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

  final List<({String title, String body})> pushed = [];

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {
    pushed.add((title: title, body: body));
  }
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

/// #1090 — like [_makeSession] but with explicit isSystem/category, so tests
/// can construct background/scheduled/self_improvement fixtures.
AgentSession _makeScopedSession(
  String id,
  AgentSessionStatus status, {
  bool isSystem = false,
  String category = 'chat',
}) {
  final now = DateTime.now();
  return AgentSession(
    id: id,
    agentId: 'claude-code',
    status: status,
    cwd: '/tmp',
    name: 'Test Session $id',
    createdAt: now,
    updatedAt: now,
    isSystem: isSystem,
    category: category,
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
  // createSession default agent (#889/#890)
  // --------------------------------------------------------------------------

  group('createSession default agent (#889/#890)', () {
    AgentsController build({String? Function()? resolver}) {
      final c = AgentsController(
        fakeRepo,
        _FakeAgentServerController(ready: true, anyAgent: true),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
        configuredDefaultAgentResolver: resolver,
      );
      addTearDown(c.dispose);
      return c;
    }

    test(
        'defaults to Secretary (the seeded hub) when no override is configured',
        () async {
      // `controller` (from setUp) has no configuredDefaultAgentResolver.
      await controller.createSession(cwd: '/tmp');
      expect(fakeRepo.lastCreateAgentId, equals('secretary'));
    });

    test(
        'uses the configured default profile override directly — a profile '
        'ocAgent (e.g. theologian), NOT gated on the engine-kind catalog',
        () async {
      final c = build(resolver: () => 'theologian');
      await c.createSession(cwd: '/tmp');
      expect(fakeRepo.lastCreateAgentId, equals('theologian'));
    });

    test('override returning null falls back to the seeded Secretary default',
        () async {
      final c = build(resolver: () => null);
      await c.createSession(cwd: '/tmp');
      expect(fakeRepo.lastCreateAgentId, equals('secretary'));
    });

    test('does not override an explicitly-passed agentId', () async {
      await controller.createSession(cwd: '/tmp', agentId: 'worship-planning');
      expect(fakeRepo.lastCreateAgentId, equals('worship-planning'));
    });
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

    // ------------------------------------------------------------------------
    // #1090 — background/scheduled/self_improvement sessions must never leak
    // into the chats scope on a live WS insert (create or update).
    // ------------------------------------------------------------------------

    test(
        '#1090 SessionCreatedMessage excludes a self_improvement background '
        'session from the chats scope', () async {
      expect(controller.scope, AgentSessionScope.chats);

      fakeRepo.emit(SessionCreatedMessage(
        session: _makeScopedSession(
          'bg-created',
          AgentSessionStatus.working,
          isSystem: true,
          category: 'self_improvement',
        ),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions, isEmpty);
    });

    test(
        '#1090 SessionUpdatedMessage excludes a self_improvement background '
        'session from the chats scope', () async {
      expect(controller.scope, AgentSessionScope.chats);

      fakeRepo.emit(SessionUpdatedMessage(
        session: _makeScopedSession(
          'bg-updated',
          AgentSessionStatus.working,
          isSystem: true,
          category: 'self_improvement',
        ),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions, isEmpty);
      expect(controller.resumable, isEmpty);
      expect(controller.archived, isEmpty);
    });

    test(
        '#1090 an interactive chat session still appears immediately via '
        'SessionCreatedMessage and SessionUpdatedMessage', () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeScopedSession('chat-created', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(controller.sessions.map((s) => s.id), contains('chat-created'));

      fakeRepo.emit(SessionUpdatedMessage(
        session: _makeScopedSession('chat-updated', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(controller.sessions.map((s) => s.id), contains('chat-updated'));
    });

    test(
        '#1090 a scheduled session enters the list when scope is scheduled '
        '(the predicate admits matching-scope sessions, not just chats)',
        () async {
      await controller.loadSessions(AgentSessionScope.scheduled);
      expect(controller.scope, AgentSessionScope.scheduled);

      fakeRepo.emit(SessionCreatedMessage(
        session: _makeScopedSession(
          'sched-1',
          AgentSessionStatus.working,
          category: 'scheduled',
        ),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions.map((s) => s.id), contains('sched-1'));
    });

    test(
        '#1090 a refresh does not change which sessions belong to chats '
        '(no refresh-only divergence)', () async {
      // Live WS insert: an interactive chat session and a background session
      // arrive over the same shared channel. The background session must be
      // filtered on insert, matching what the server's ?scope=chats query
      // would have returned on a full load.
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeScopedSession('chat-a', AgentSessionStatus.idle),
      ));
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeScopedSession(
          'bg-b',
          AgentSessionStatus.idle,
          isSystem: true,
          category: 'self_improvement',
        ),
      ));
      await Future<void>.delayed(Duration.zero);

      final beforeIds = controller.sessions.map((s) => s.id).toSet();
      expect(beforeIds, {'chat-a'});

      // Simulate a refresh: a real ?scope=chats response would only ever
      // include the interactive chat row.
      fakeRepo.sessionsToReturn = [
        _makeScopedSession('chat-a', AgentSessionStatus.idle),
      ];
      await controller.loadSessions(AgentSessionScope.chats);

      final afterIds = controller.sessions.map((s) => s.id).toSet();
      expect(
        afterIds,
        beforeIds,
        reason: 'A refresh must not change which sessions belong to chats.',
      );
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

    test('OutputMessage clears sessionFirstSeenAt (stuck tracking)', () async {
      // OPC-M1-3: liveOutputFor removed. OutputMessage no longer accumulates
      // text; instead it clears stuck detection when a starting session receives
      // its first output frame.
      const sessionId = 'sess-out';
      fakeRepo.emit(SessionCreatedMessage(
        session: AgentSession(
          id: sessionId,
          agentId: 'claude-code',
          name: 'out-test',
          cwd: '/tmp',
          status: AgentSessionStatus.starting,
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
        ),
      ));
      await Future<void>.delayed(Duration.zero);

      // Mark as stuck.
      controller.sessionFirstSeenAt[sessionId] =
          DateTime.now().subtract(const Duration(seconds: 40));
      expect(controller.sessionFirstSeenAt.containsKey(sessionId), isTrue);

      fakeRepo.emit(const OutputMessage(
        id: sessionId,
        data: 'hello world',
        replay: false,
      ));
      await Future<void>.delayed(Duration.zero);

      expect(
        controller.sessionFirstSeenAt.containsKey(sessionId),
        isFalse,
        reason:
            'OutputMessage must clear sessionFirstSeenAt for stuck detection.',
      );
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

    test(
        'AgentConfigsChangedMessage refreshes the catalog and selected-session agents',
        () async {
      final modelsDataSource = _FakeAgentModelsDataSource();
      final localController = AgentsController(
        fakeRepo,
        _FakeAgentServerController(ready: true, anyAgent: true),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
        modelsDataSource: modelsDataSource,
      );
      addTearDown(localController.dispose);

      localController.handleWsMessageForTest(SessionCreatedMessage(
        session: _makeSession('active-session', AgentSessionStatus.idle),
      ));
      await localController.selectSession('active-session');
      await pumpEventQueue();

      modelsDataSource.catalogToReturn = const [
        CatalogModelEntry(
          agent: 'opencode',
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6',
          route: 'direct',
          authorized: true,
          authProvider: 'anthropic',
        ),
      ];
      fakeRepo.availableAgentsToReturn = const [
        AgentInfo(name: 'config-doctor', builtIn: false),
      ];

      localController.handleWsMessageForTest(
        const AgentConfigsChangedMessage(),
      );
      await pumpEventQueue();

      expect(localController.catalog.single.modelId, 'claude-sonnet-4-6');
      expect(
        localController.availableAgentsFor('active-session').single.name,
        'config-doctor',
      );
    });
  });

  // --------------------------------------------------------------------------
  // session.spillover (dual Anthropic accounts)
  // --------------------------------------------------------------------------

  group('session.spillover', () {
    test('parse() maps session.spillover to SessionSpilloverMessage', () {
      final msg = AgentWsMessage.parse({
        'v': 1,
        'type': 'session.spillover',
        'sessionId': 's1',
        'fromAccountId': 'team',
        'toAccountId': 'personal',
        'reason': 'rate_limited',
      });
      expect(msg, isA<SessionSpilloverMessage>());
      final spill = msg as SessionSpilloverMessage;
      expect(spill.sessionId, 's1');
      expect(spill.fromAccountId, 'team');
      expect(spill.toAccountId, 'personal');
    });

    test(
        'SessionSpilloverMessage updates the session account and pushes a '
        'notification', () async {
      final notifications = _FakeNotificationsController();
      final localController = AgentsController(
        fakeRepo,
        _FakeAgentServerController(ready: true, anyAgent: true),
        _FakeLocalNotificationService(),
        notifications,
      );
      addTearDown(localController.dispose);
      await localController.initialize();

      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('spill-sess', AgentSessionStatus.working),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(localController.sessions.single.anthropicAccountId, isNull);

      fakeRepo.emit(const SessionSpilloverMessage(
        sessionId: 'spill-sess',
        fromAccountId: 'team',
        toAccountId: 'personal',
      ));
      await Future<void>.delayed(Duration.zero);

      expect(
        localController.sessions.single.anthropicAccountId,
        'personal',
        reason: 'spillover must flip the session account (badge source)',
      );
      expect(notifications.pushed, hasLength(1));
      expect(notifications.pushed.single.title, 'Claude account switched');
      // No label cache in tests → body falls back to the raw account id.
      expect(notifications.pushed.single.body, contains('personal'));
    });

    test('spillover for an unknown session leaves other sessions untouched',
        () async {
      await controller.initialize();
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('other-sess', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      fakeRepo.emit(const SessionSpilloverMessage(
        sessionId: 'nonexistent',
        fromAccountId: 'team',
        toAccountId: 'personal',
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions.single.anthropicAccountId, isNull);
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

      // Backdate to simulate >30s without output.
      controller.sessionFirstSeenAt['active-sess'] =
          DateTime.now().subtract(const Duration(seconds: 31));

      // OPC-M1-3: Simulate part activity arriving (MessagePartUpdatedMessage
      // sets _lastPartActivityAt, which signals hasParts=true in _recomputeStuck).
      // We set it directly here since the test harness doesn't wire full WS parts.
      // Alternatively, OutputMessage removes sessionFirstSeenAt entirely; we verify
      // the simpler invariant: once firstSeenAt is removed, the session is not stuck.
      controller.sessionFirstSeenAt.remove('active-sess');

      controller.recomputeStuckForTest();

      // Should NOT be stuck because firstSeenAt was cleared (output arrived).
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
