import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/agent_trigger_watcher.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/constants/app_constants.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/core/services/server_config_service.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
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
  Future<void> stop() async {}
}

class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController({required bool ready})
      : _ready = ready,
        super(_FakeApiServerService());

  final bool _ready;

  /// F2: counts how many times the auth-change re-fire hook was invoked.
  int onAuthChangedCount = 0;

  @override
  bool get isReady => _ready;

  @override
  bool get hasAnyAgent => _ready;

  @override
  void onAuthChanged() {
    onAuthChangedCount++;
  }

  @override
  Future<void> initialize() async {}
}

class _FakeAgentsRepository implements AgentsRepository {
  _FakeAgentsRepository()
      : _msgController = StreamController<AgentWsMessage>.broadcast(),
        _connectivityController = StreamController<bool>.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;
  final List<
      ({
        String sessionId,
        String? agentId,
        String? profileId,
        String? taskId,
        String name,
      })> creates = [];
  final List<Map<String, dynamic>> sentMessages = [];
  bool failNextCreate = false;

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => false;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  bool send(Map<String, dynamic> msg) {
    sentMessages.add(msg);
    return true;
  }

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      [];

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
        name: 'Fake',
        createdAt: now,
        updatedAt: now,
      ),
      messages: <AgentSessionMessage>[],
    );
  }

  @override
  Future<AgentSession> createSession({
    String? profileId,
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
    final sessionId = 'new-${creates.length + 1}';
    creates.add((
      sessionId: sessionId,
      agentId: agentId,
      profileId: profileId,
      taskId: taskId,
      name: name,
    ));
    if (failNextCreate) {
      failNextCreate = false;
      throw StateError('temporary create failure');
    }
    final now = DateTime.now();
    return AgentSession(
      id: sessionId,
      agentId: agentId ?? '__pending__',
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
  Future<void> deleteSession(String id) async {}

  @override
  Future<void> cancelSession(String id) async {}

  @override
  Future<AgentSession> updateSession(
    String id, {
    String? profileId,
    String? name,
    String? providerId,
    String? modelId,
    String? permissionMode,
    bool clearProvider = false,
    bool clearModel = false,
    bool? fastMode,
    String? anthropicAccountId,
    String? agentId,
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
  Future<AgentSession> resumeSession(String id) async {
    final now = DateTime.now();
    return AgentSession(
      id: id,
      agentId: 'claude-code',
      status: AgentSessionStatus.idle,
      cwd: '/tmp',
      name: 'Resumed',
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<AgentSession> archiveSession(String id) async {
    final now = DateTime.now();
    return AgentSession(
      id: id,
      agentId: 'claude-code',
      status: AgentSessionStatus.closed,
      cwd: '/tmp',
      name: 'Archived',
      archivedAt: now,
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<AgentSession> unarchiveSession(String id) async {
    final now = DateTime.now();
    return AgentSession(
      id: id,
      agentId: 'claude-code',
      status: AgentSessionStatus.idle,
      cwd: '/tmp',
      name: 'Unarchived',
      createdAt: now,
      updatedAt: now,
    );
  }

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
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async => [];

  @override
  Future<Map<String, dynamic>> fetchMemoryProvenance(String id) async =>
      {'recorded': false, 'memoryIds': [], 'notePaths': []};

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
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];

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

class _Configs extends AgentConfigsDataSource {
  _Configs({this.loaded = true});
  bool loaded;

  @override
  Future<List<AgentConfig>> list() async => loaded
      ? [
          AgentConfig(
              id: 'worship-profile',
              label: 'Worship Assistant',
              icon: 'assets/icons/claude_code.png',
              enabled: true,
              isAgent: true,
              ocAgent: 'worship-agent',
              sortOrder: 0),
        ]
      : [];
}

class _Projects extends AgentProjectsRemoteDataSource {
  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async => [];
}

class _Tasks extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
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

  /// Test-only: simulate a token change firing [notifyListeners] (as
  /// signInWithGoogle / restoreSession do on a real token rotation).
  void simulateAuthChange() => notifyListeners();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AgentsController agentsController;
  late _FakeAgentServerController agentServerController;
  late ServerConfigService serverConfigService;

  setUp(() {
    agentServerController = _FakeAgentServerController(ready: true);
    agentsController = AgentsController(
      _FakeAgentsRepository(),
      agentServerController,
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
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
    test('polls only the local trigger origin without a cloud token', () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
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

      expect(requests, isNotEmpty);
      for (final request in requests) {
        expect(request.method, 'GET');
        expect(request.url.origin, AppConstants.agentLocalBaseUrl);
        expect(request.headers.containsKey('authorization'), isFalse);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Polling when authenticated and agent server ready
  // --------------------------------------------------------------------------

  group('when authenticated and agent server is ready', () {
    testWidgets(
        'issue-1491-W1b: local webhook is namespaced, started with its profile, and staged once',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository();
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      addTearDown(controller.dispose);
      final deleted = <Uri>[];
      final client = MockClient((request) async {
        final isLocal = request.url.origin == AppConstants.agentLocalBaseUrl;
        if (request.method == 'GET') {
          return http.Response(
            jsonEncode(isLocal
                ? [
                    {
                      'id': 42,
                      'taskTitle': 'Local webhook event',
                      'webhookEndpointId': 'endpoint-42',
                      'webhookEndpointName': 'Local endpoint',
                      'profileId': 'worship-profile',
                      'prompt': 'local webhook draft',
                    }
                  ]
                : <Object>[]),
            200,
          );
        }
        if (request.method == 'DELETE') {
          deleted.add(request.url);
          return http.Response('', 204);
        }
        return http.Response('', 404);
      });
      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: _StubAuthSessionService(token: null),
        agentServerController: agentServerController,
        agentsController: controller,
        interval: const Duration(milliseconds: 50),
        httpClient: client,
      );
      addTearDown(watcher.dispose);
      watcher.start();
      await tester.pump(const Duration(milliseconds: 100));
      watcher.stop();

      expect(controller.pendingTriggers, hasLength(1));
      expect(controller.pendingTriggers.single.taskId, 'local:42');
      expect(
        deleted,
        contains(
            Uri.parse('${AppConstants.agentLocalBaseUrl}/claude-triggers/42')),
      );

      final configs =
          AgentConfigsController(AgentConfigsRepository(_Configs()));
      await configs.refresh();
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));
      await tester.pump();
      expect(find.text('Start Worship Assistant'), findsOneWidget);
      await tester.tap(find.text('Start Worship Assistant'));
      await tester.pump();
      await tester.pump();
      expect(repo.creates, hasLength(1));
      expect(repo.creates.single.profileId, 'worship-profile');
      expect(find.textContaining('local webhook draft'), findsWidgets);
      expect(controller.consumeComposerDraft('new-1'), isNull,
          reason: 'the local webhook draft is staged exactly once');
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    test('same numeric id is independent across production and local origins',
        () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        final isLocal = request.url.origin == AppConstants.agentLocalBaseUrl;
        if (request.method == 'GET') {
          return http.Response(
            jsonEncode([
              {
                'id': 7,
                'taskTitle': isLocal ? 'Local seven' : 'Production seven',
              }
            ]),
            200,
          );
        }
        return http.Response('', 204);
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

      expect(agentsController.pendingTriggers.map((item) => item.taskId),
          containsAll(['7', 'local:7']));
      final deletes = requests.where((item) => item.method == 'DELETE');
      expect(
        deletes.any((item) =>
            item.url.origin == AppConstants.agentLocalBaseUrl &&
            item.url.path.endsWith('/7') &&
            !item.headers.containsKey('authorization')),
        isTrue,
      );
      expect(
        deletes.any((item) =>
            item.url.origin == serverConfigService.url &&
            item.url.path.endsWith('/7') &&
            item.headers['authorization'] == 'Bearer tok-abc'),
        isTrue,
      );
    });

    test('a local error does not stop the production poll', () async {
      final client = MockClient((request) async {
        if (request.method == 'DELETE') return http.Response('', 204);
        if (request.url.origin == AppConstants.agentLocalBaseUrl) {
          return http.Response('unauthorized', 401);
        }
        return http.Response(
          jsonEncode([
            {'id': 'production-trigger', 'taskTitle': 'Production trigger'}
          ]),
          200,
        );
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

      expect(
        agentsController.pendingTriggers
            .any((item) => item.taskId == 'production-trigger'),
        isTrue,
      );
    });

    testWidgets(
        'issue-1491-c3: banner starts configured profile and stages one editable draft',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository();
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      final configs =
          AgentConfigsController(AgentConfigsRepository(_Configs()));
      await configs.refresh();
      addTearDown(controller.dispose);
      await controller.handleIncomingTrigger({
        'id': 1491,
        'taskId': null,
        'taskTitle': 'Inspect PCO changes',
        'scheduledTaskId': 'scheduled-1491',
        'webhookEndpointId': 'endpoint-1491',
        'webhookEndpointName': 'PCO callback',
        'profileId': 'worship-profile',
        'prompt': 'untrusted external webhook data: Service changed',
      });
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));
      await tester.pump();
      expect(find.textContaining('Inspect PCO changes'), findsWidgets);
      expect(find.text('Start Worship Assistant'), findsOneWidget);
      Focus.of(tester.element(find.text('Start Worship Assistant')))
          .requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      await tester.pump();
      expect(repo.creates, hasLength(1));
      expect(repo.creates.single, (
        sessionId: 'new-1',
        agentId: 'worship-agent',
        profileId: 'worship-profile',
        taskId: null,
        name: 'Webhook: PCO callback',
      ));
      expect(
          find.textContaining(
              'untrusted external webhook data: Service changed'),
          findsWidgets);
      expect(controller.consumeComposerDraft('new-1'), isNull);
      expect(repo.sentMessages.toString(),
          isNot(contains('untrusted external webhook data')),
          reason:
              'External content must remain a draft, not an automatic turn');
      expect(controller.pendingTriggers, isEmpty);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    testWidgets(
        'issue-1491-c3: two webhook banners retain independent identity after sequential starts',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository();
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      final configs =
          AgentConfigsController(AgentConfigsRepository(_Configs()));
      await configs.refresh();
      addTearDown(controller.dispose);
      for (final id in [1, 2]) {
        await controller.handleIncomingTrigger({
          'id': id,
          'taskTitle': 'Event $id',
          'webhookEndpointId': 'endpoint-$id',
          'webhookEndpointName': 'Endpoint $id',
          'profileId': 'worship-profile',
          'prompt': 'draft $id'
        });
      }
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));
      await tester.pump();
      expect(find.text('Start Worship Assistant'), findsNWidgets(2));
      await tester.tap(find.text('Start Worship Assistant').first);
      await tester.pump();
      await tester.pump();
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('agent-composer-input')),
            )
            .controller!
            .text,
        'draft 1',
      );
      expect(controller.pendingTriggers.map((e) => e.taskTitle), ['Event 2']);
      await tester.tap(find.text('Start Worship Assistant'));
      await tester.pump();
      await tester.pump();
      expect(repo.creates, hasLength(2));
      expect(repo.creates.map((create) => create.sessionId), [
        'new-1',
        'new-2',
      ]);
      expect(repo.creates.map((create) => create.name), [
        'Webhook: Endpoint 1',
        'Webhook: Endpoint 2',
      ]);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('agent-composer-input')),
            )
            .controller!
            .text,
        'draft 2',
      );
      await controller.selectSession('new-1');
      await tester.pump();
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('agent-composer-input')),
            )
            .controller!
            .text,
        'draft 1',
      );
      expect(controller.pendingTriggers, isEmpty);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    testWidgets(
        'issue-1491-c3: occupied composer keeps a webhook draft '
        'pending until empty', (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository();
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      final configs =
          AgentConfigsController(AgentConfigsRepository(_Configs()));
      await configs.refresh();
      addTearDown(controller.dispose);
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));

      final session = await controller.createSession(
        agentId: 'worship-agent',
        profileId: 'worship-profile',
        cwd: '/tmp',
      );
      await controller.selectSession(session!.id);
      await tester.pump();
      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        'Keep my existing note',
      );
      controller.setComposerDraft(session.id, 'pending webhook draft');
      await tester.pump();
      await tester.pump();

      expect(controller.hasComposerDraft(session.id), isTrue);
      expect(find.byKey(const ValueKey('pending-composer-draft-banner')),
          findsOneWidget);
      expect(find.text('Keep my existing note'), findsOneWidget);
      expect(repo.sentMessages.toString(), isNot(contains('pending webhook')));

      // Regression: when the post-frame prefill sees an occupied composer, a
      // setState here used to rebuild and schedule the same callback forever.
      // Bounded pumps expose that loop without pumpAndSettle hanging.
      for (var frame = 0; frame < 6; frame++) {
        await tester.pump(const Duration(milliseconds: 1));
      }
      // The transcript's normal scroll animation lasts 200 ms. Let it finish
      // before checking for the occupied-draft rebuild loop.
      await tester.pump(const Duration(milliseconds: 250));
      expect(tester.binding.hasScheduledFrame, isFalse,
          reason: 'an occupied composer must not perpetually schedule frames');
      expect(controller.hasComposerDraft(session.id), isTrue,
          reason: 'the incoming webhook draft stays pending');
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('agent-composer-input')),
            )
            .controller!
            .text,
        'Keep my existing note',
        reason: 'the pending draft must not overwrite the user draft',
      );

      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        '',
      );
      await tester.pump();
      await tester.pump();
      expect(controller.hasComposerDraft(session.id), isFalse);
      expect(find.text('pending webhook draft'), findsOneWidget);
      expect(repo.sentMessages.toString(), isNot(contains('pending webhook')));
      expect(controller.consumeComposerDraft(session.id), isNull,
          reason: 'the webhook draft is consumed exactly once');
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    testWidgets(
        'issue-1491-c3: scheduled trigger with profile metadata still starts Secretary without draft',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository();
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      final configs =
          AgentConfigsController(AgentConfigsRepository(_Configs()));
      await configs.refresh();
      addTearDown(controller.dispose);
      await controller.handleIncomingTrigger({
        'id': 7,
        'taskId': 'task-7',
        'taskTitle': 'Scheduled',
        'profileId': 'worship-profile',
        'prompt': 'should not draft'
      });
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));
      await tester.pump();
      await tester.tap(find.text('Start Secretary'));
      await tester.pump();
      await tester.pump();
      expect(repo.creates.single, (
        sessionId: 'new-1',
        agentId: 'secretary',
        profileId: 'secretary',
        taskId: 'task-7',
        name: 'Scheduled',
      ));
      expect(controller.consumeComposerDraft('new-1'), isNull);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    testWidgets(
        'issue-1491-c3: late profile load changes webhook label and a failed start retries',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository()..failNextCreate = true;
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      final source = _Configs(loaded: false);
      final configs = AgentConfigsController(AgentConfigsRepository(source));
      await configs.refresh();
      addTearDown(controller.dispose);
      await controller.handleIncomingTrigger({
        'id': 30,
        'taskTitle': '',
        'webhookEndpointId': 'endpoint-30',
        'profileId': 'worship-profile',
        'prompt': 'draft 30'
      });
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));
      await tester.pump();
      expect(find.textContaining('endpoint-30'), findsWidgets);
      expect(find.text('Start worship-profile'), findsOneWidget);
      source.loaded = true;
      await configs.refresh();
      await tester.pump();
      expect(find.text('Start Worship Assistant'), findsOneWidget);
      await tester.tap(find.text('Start Worship Assistant'));
      await tester.pump();
      expect(controller.pendingTriggers, hasLength(1));
      await tester.tap(find.text('Start Worship Assistant'));
      await tester.pump();
      await tester.pump();
      expect(repo.creates, hasLength(2));
      expect(repo.creates.last.agentId, 'worship-agent');
      expect(repo.creates.last.name, 'Webhook: endpoint-30');
      expect(controller.pendingTriggers, isEmpty);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    testWidgets(
        'issue-1491-c3: webhook without profile selects Secretary but still stages draft',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repo = _FakeAgentsRepository();
      final controller = AgentsController(repo, agentServerController,
          _FakeLocalNotificationService(), _FakeNotificationsController());
      final configs =
          AgentConfigsController(AgentConfigsRepository(_Configs()));
      await configs.refresh();
      addTearDown(controller.dispose);
      await controller.handleIncomingTrigger({
        'id': 31,
        'taskTitle': 'Incoming',
        'webhookEndpointId': 'endpoint-31',
        'webhookEndpointName': 'Incoming webhook',
        'prompt': 'draft 31'
      });
      await tester.pumpWidget(MultiProvider(providers: [
        ChangeNotifierProvider<AgentServerController>.value(
            value: agentServerController),
        ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_Tasks()))),
        ChangeNotifierProvider<AgentProjectsController>.value(
            value:
                AgentProjectsController(AgentProjectsRepository(_Projects()))),
        ChangeNotifierProvider<DestructiveModalService>(
            create: (_) => DestructiveModalService()),
      ], child: const MaterialApp(home: Scaffold(body: AgentsView()))));
      await tester.pump();
      await tester.tap(find.text('Start Secretary'));
      await tester.pump();
      await tester.pump();
      expect(repo.creates.single, (
        sessionId: 'new-1',
        agentId: 'secretary',
        profileId: 'secretary',
        taskId: null,
        name: 'Webhook: Incoming webhook',
      ));
      expect(find.textContaining('draft 31'), findsWidgets);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    });

    test(
        'issue-1491-c3: webhook poll preserves target and untrusted draft exactly once',
        () async {
      final trigger = {
        'id': 1491,
        'taskId': null,
        'taskTitle': 'Inspect PCO changes',
        'scheduledTaskId': 'scheduled-1491',
        'webhookEndpointId': 'endpoint-1491',
        'webhookEndpointName': 'PCO callback',
        'profileId': 'worship-profile',
        'prompt':
            'Summarize the PCO change\n\nUntrusted external webhook event: updated',
      };
      final client = MockClient((request) async {
        if (request.method == 'GET') {
          return http.Response(
            jsonEncode(request.url.origin == AppConstants.agentLocalBaseUrl
                ? <Object>[]
                : [trigger]),
            200,
          );
        }
        return http.Response('', 204);
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
      await Future<void>.delayed(const Duration(milliseconds: 110));
      expect(agentsController.pendingTriggers, hasLength(1));
      final pending = agentsController.pendingTriggers.single;
      expect(pending.taskTitle, 'Inspect PCO changes');
      expect((pending as dynamic).profileId, 'worship-profile');
      expect((pending as dynamic).prompt, trigger['prompt']);
      expect((pending as dynamic).scheduledTaskId, 'scheduled-1491');
      expect((pending as dynamic).webhookEndpointName, 'PCO callback');
    });

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
          if (request.url.origin == AppConstants.agentLocalBaseUrl) {
            return http.Response('[]', 200);
          }
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
          if (request.url.origin == AppConstants.agentLocalBaseUrl) {
            return http.Response('[]', 200);
          }
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
          if (request.url.origin == AppConstants.agentLocalBaseUrl) {
            return http.Response('[]', 200);
          }
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
  // RHYTHM_LOCAL_SMOKE gate
  // --------------------------------------------------------------------------

  group('RHYTHM_LOCAL_SMOKE gate', () {
    // The dart-define path (String.fromEnvironment) cannot be flipped at
    // runtime in unit tests, but the Platform.environment branch can be
    // exercised indirectly by verifying isLocalSmokeRun returns false in a
    // normal test environment (RHYTHM_LOCAL_SMOKE is not set by the test
    // runner) and that start() proceeds normally when the flag is absent.
    test('isLocalSmokeRun is false in normal test environment', () {
      // The environment variable is not set by the test runner, and the
      // dart-define is not provided, so the gate should be open.
      expect(isLocalSmokeRun, isFalse);
    });

    test('start() sets isPolling when RHYTHM_LOCAL_SMOKE is not set', () async {
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
      // start() should have proceeded — isPolling becomes true.
      expect(watcher.isPolling, isTrue);
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

  // --------------------------------------------------------------------------
  // F2: auth-change re-fire wiring
  // --------------------------------------------------------------------------

  group('auth-change re-fire (F2)', () {
    test('AuthSessionService notify drives AgentServerController.onAuthChanged',
        () {
      final auth = _StubAuthSessionService(token: 'tok');
      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: auth,
        agentServerController: agentServerController,
        agentsController: agentsController,
      );
      addTearDown(watcher.dispose);

      expect(agentServerController.onAuthChangedCount, 0);

      auth.simulateAuthChange();
      expect(agentServerController.onAuthChangedCount, 1);

      auth.simulateAuthChange();
      expect(agentServerController.onAuthChangedCount, 2);
    });

    test('listener is removed on dispose (no leak / no further fires)', () {
      final auth = _StubAuthSessionService(token: 'tok');
      final watcher = AgentTriggerWatcher(
        serverConfigService: serverConfigService,
        authSessionService: auth,
        agentServerController: agentServerController,
        agentsController: agentsController,
      );

      auth.simulateAuthChange();
      expect(agentServerController.onAuthChangedCount, 1);

      watcher.dispose();

      // After dispose the listener must be gone — further notifications are
      // no-ops on the controller.
      auth.simulateAuthChange();
      expect(agentServerController.onAuthChangedCount, 1);
    });
  });
}
