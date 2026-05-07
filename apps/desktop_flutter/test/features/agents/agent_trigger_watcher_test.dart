import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/agent_trigger_watcher.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/core/services/server_config_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';

// ---------------------------------------------------------------------------
// Fakes / stubs
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null);
  @override
  Future<void> stop() async {}
}

class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController({required bool ready})
      : _ready = ready,
        super(_FakeApiServerService());

  final bool _ready;

  @override
  bool get isReady => _ready;

  @override
  bool get hasAnyAgent => _ready;

  @override
  Future<void> initialize() async {}
}

class _FakeAgentsRepository implements AgentsRepository {
  _FakeAgentsRepository()
      : _msgController = StreamController<AgentWsMessage>.broadcast();

  final StreamController<AgentWsMessage> _msgController;

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  bool get isConnected => false;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions() async => [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final now = DateTime.now();
    return (
      session: AgentSession(
        id: id,
        agentKind: AgentKind.claudeCode,
        status: AgentSessionStatus.idle,
        cwd: '/tmp',
        name: 'Fake',
        createdAt: now,
        updatedAt: now,
      ),
      messages: <AgentSessionMessage>[],
    );
  }

  @override
  Future<AgentSession> createSession({
    required AgentKind agentKind,
    String? taskId,
    required String cwd,
    required String name,
  }) async {
    final now = DateTime.now();
    return AgentSession(
      id: 'new',
      agentKind: agentKind,
      status: AgentSessionStatus.starting,
      cwd: cwd,
      name: name,
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<void> closeSession(String id) async {}

  @override
  Future<AgentSession> resumeSession(String id) async {
    final now = DateTime.now();
    return AgentSession(
      id: id,
      agentKind: AgentKind.claudeCode,
      status: AgentSessionStatus.idle,
      cwd: '/tmp',
      name: 'Resumed',
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) async {
    return [];
  }
}

/// A stub [AuthDataSource] that does nothing (prevents real network calls).
class _FakeAuthDataSource extends AuthDataSource {
  _FakeAuthDataSource() : super(baseUrl: 'http://localhost:4000');
}

/// A stub [AuthSessionService] that returns a configurable session token
/// without touching [SharedPreferences] or making network calls.
class _StubAuthSessionService extends AuthSessionService {
  _StubAuthSessionService({String? token})
      : _token = token,
        super(_FakeAuthDataSource());

  final String? _token;

  @override
  String? get sessionToken => _token;

  @override
  bool get isAuthenticated => _token != null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late AgentsController agentsController;
  late _FakeAgentServerController agentServerController;
  late ServerConfigService serverConfigService;

  setUp(() {
    agentServerController = _FakeAgentServerController(ready: true);
    agentsController = AgentsController(
      _FakeAgentsRepository(),
      agentServerController,
    );
    serverConfigService = ServerConfigService();
  });

  tearDown(() {
    agentsController.dispose();
  });

  // --------------------------------------------------------------------------
  // No-auth guard
  // --------------------------------------------------------------------------

  group('without authentication', () {
    test('does not make any HTTP requests when sessionToken is null', () async {
      var requestCount = 0;
      final client = MockClient((_) async {
        requestCount++;
        return http.Response('[]', 200);
      });

      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: null),
        agentServerController: agentServerController,
        agentsController: agentsController,
        interval: const Duration(milliseconds: 50),
        httpClient: client,
      );
      addTearDown(watcher.dispose);

      watcher.start();
      await Future<void>.delayed(const Duration(milliseconds: 200));

      expect(requestCount, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Polling when authenticated and agent server ready
  // --------------------------------------------------------------------------

  group('when authenticated and agent server is ready', () {
    test('polls GET /claude-triggers and adds pending trigger', () async {
      final trigger = {
        'id': 'tr-1',
        'taskId': 'task-99',
        'taskTitle': 'Ship it',
      };

      var getCount = 0;
      var deleteCount = 0;

      final client = MockClient((request) async {
        if (request.method == 'GET' &&
            request.url.path.endsWith('/claude-triggers')) {
          getCount++;
          return http.Response(jsonEncode([trigger]), 200);
        }
        if (request.method == 'DELETE' &&
            request.url.path.contains('/claude-triggers/')) {
          deleteCount++;
          return http.Response('', 204);
        }
        return http.Response('not found', 404);
      });

      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: 'tok-abc'),
        agentServerController: agentServerController,
        agentsController: agentsController,
        interval: const Duration(milliseconds: 50),
        httpClient: client,
      );
      addTearDown(watcher.dispose);

      watcher.start();
      // Allow an immediate poll to complete.
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(getCount, greaterThan(0));
      // Trigger was added exactly once (deduplication in AgentsController).
      expect(agentsController.pendingTriggers, hasLength(1));
      expect(agentsController.pendingTriggers.first.taskId, 'task-99');
      expect(agentsController.pendingTriggers.first.taskTitle, 'Ship it');
      // DELETE was called at least once.
      expect(deleteCount, greaterThan(0));
    });

    test('deduplicates: same trigger polled twice does not create two bubbles',
        () async {
      final trigger = {
        'id': 'tr-dup',
        'taskId': 'task-dup',
        'taskTitle': 'Duplicate',
      };

      // Simulate DELETE failing so the trigger keeps reappearing.
      final client = MockClient((request) async {
        if (request.method == 'GET') {
          return http.Response(jsonEncode([trigger]), 200);
        }
        // DELETE returns 500 — trigger is not consumed.
        return http.Response('error', 500);
      });

      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: 'tok-abc'),
        agentServerController: agentServerController,
        agentsController: agentsController,
        interval: const Duration(milliseconds: 50),
        httpClient: client,
      );
      addTearDown(watcher.dispose);

      watcher.start();
      // Allow several ticks to fire.
      await Future<void>.delayed(const Duration(milliseconds: 250));

      // Despite multiple polls, the trigger should only appear once.
      expect(
        agentsController.pendingTriggers
            .where((t) => t.taskId == 'task-dup')
            .length,
        1,
      );
    });

    test('calls DELETE after a successful handoff', () async {
      final trigger = {
        'id': 'tr-del',
        'taskId': 'task-del',
        'taskTitle': 'Delete me',
      };

      final deletedIds = <String>[];

      final client = MockClient((request) async {
        if (request.method == 'GET') {
          return http.Response(jsonEncode([trigger]), 200);
        }
        if (request.method == 'DELETE') {
          final id = request.url.pathSegments.last;
          deletedIds.add(id);
          return http.Response('', 204);
        }
        return http.Response('', 404);
      });

      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: 'tok-abc'),
        agentServerController: agentServerController,
        agentsController: agentsController,
        interval: const Duration(milliseconds: 50),
        httpClient: client,
      );
      addTearDown(watcher.dispose);

      watcher.start();
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(deletedIds, contains('tr-del'));
    });
  });

  // --------------------------------------------------------------------------
  // Agent server not ready
  // --------------------------------------------------------------------------

  group('when agent server is not ready', () {
    test('does not poll even if authenticated', () async {
      var requestCount = 0;
      final client = MockClient((_) async {
        requestCount++;
        return http.Response('[]', 200);
      });

      final notReadyController = _FakeAgentServerController(ready: false);

      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: 'tok-abc'),
        agentServerController: notReadyController,
        agentsController: agentsController,
        interval: const Duration(milliseconds: 50),
        httpClient: client,
      );
      addTearDown(watcher.dispose);

      watcher.start();
      await Future<void>.delayed(const Duration(milliseconds: 200));

      expect(requestCount, 0);
    });
  });

  // --------------------------------------------------------------------------
  // isPolling flag
  // --------------------------------------------------------------------------

  group('isPolling', () {
    test('is false before start()', () {
      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: 'tok'),
        agentServerController: agentServerController,
        agentsController: agentsController,
      );
      addTearDown(watcher.dispose);

      expect(watcher.isPolling, isFalse);
    });

    test('is true after start() and false after stop()', () async {
      final client = MockClient((_) async => http.Response('[]', 200));

      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: 'tok'),
        agentServerController: agentServerController,
        agentsController: agentsController,
        httpClient: client,
      );
      addTearDown(watcher.dispose);

      watcher.start();
      expect(watcher.isPolling, isTrue);

      watcher.stop();
      expect(watcher.isPolling, isFalse);
    });
  });
}
