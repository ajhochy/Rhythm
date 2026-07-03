/// Mounted-surface test for the enriched Context tab of the inspector panel.
///
/// Pumps the REAL AgentsView with a selected session so SessionSidePanel
/// mounts and the Context tab (default) renders. Asserts the new Context-tab
/// fields are present:
///   - cumulative session cost (context-cost)
///   - token breakdown (context-tokens-input / context-tokens-output)
///   - model display name (context-model)
///   - message count (context-message-count)
///
/// A second test confirms a session with NO messages keeps the existing
/// "No messages yet" empty state and omits the cost row.
///
/// Run with:
///   flutter test test/features/agents/inspector_context_mounted_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

// ---------------------------------------------------------------------------
// Stubs / fakes (mirror inspector_collapse_mounted_test.dart)
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
  _StubAgentsRepository();

  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  @override
  Stream<AgentWsMessage> get messages => _msgCtrl.stream;

  @override
  Stream<bool> get connectivityStream => _connCtrl.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgCtrl.close();
    await _connCtrl.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

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

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);

  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => _configs;
}

class _EmptyAgentProjectsRemote extends AgentProjectsRemoteDataSource {
  _EmptyAgentProjectsRemote() : super();

  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async =>
      const [];
}

class _EmptyTasksLocalDataSource extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
}

// ---------------------------------------------------------------------------

final _kCreated = DateTime(2026, 6, 1, 9, 30);
final _kUpdated = DateTime(2026, 6, 2, 14, 15);

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      createdAt: _kCreated,
      updatedAt: _kUpdated,
    );

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

void _seedMessage(
  AgentsController controller, {
  required String sessionId,
  required String messageId,
  String role = 'assistant',
  double? cost,
  Map<String, dynamic>? tokens,
}) {
  controller.handleWsMessageForTest(
    MessageUpdatedMessage(
      sessionId: sessionId,
      info: <String, dynamic>{
        'id': messageId,
        'role': role,
        if (cost != null) 'cost': cost,
        if (tokens != null) 'tokens': tokens,
      },
    ),
  );
}

Future<Widget> _buildTestApp(
    {required AgentsController agentsController}) async {
  final agentServerController = _ReadyAgentServerController();
  final agentConfigsController = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource([_claudeCodeConfig])),
  );
  await agentConfigsController.refresh();

  final tasksController = TasksController(
    TasksRepository(_EmptyTasksLocalDataSource()),
  );
  final agentProjectsController = AgentProjectsController(
    AgentProjectsRepository(_EmptyAgentProjectsRemote()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: agentServerController,
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
      ChangeNotifierProvider<AgentsController>.value(
        value: agentsController,
      ),
      ChangeNotifierProvider<TasksController>.value(value: tasksController),
      ChangeNotifierProvider<AgentProjectsController>.value(
        value: agentProjectsController,
      ),
      ChangeNotifierProvider<DestructiveModalService>(
        create: (_) => DestructiveModalService(),
      ),
    ],
    child: const MaterialApp(home: Scaffold(body: AgentsView())),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    '#862: memory provenance is an integrated Context-tab section — '
    'count row + readable titles, no raw slug, no separate footer panel',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );

      await tester.runAsync(() async {
        await controller.initialize();
        controller.setActiveSessionForTest('s1', _makeSession('s1'));
        _seedMessage(
          controller,
          sessionId: 's1',
          messageId: 'm1',
          cost: 0.001,
          tokens: const {'input': 10, 'output': 5},
        );
      });
      controller.setMemoryProvenanceForTest('s1', {
        'recorded': true,
        'memoryIds': ['mem-1'],
        'notePaths': [
          'memory/preference/standing-instruction-archive-research.md',
        ],
      });

      await tester
          .pumpWidget(await _buildTestApp(agentsController: controller));
      await tester.pump();

      // The section renders inside the Context tab's detail list.
      expect(find.text('Memories used'), findsOneWidget);
      expect(
        tester
            .widget<Text>(find.byKey(const ValueKey('context-memories-count')))
            .data,
        '1',
      );
      // Readable title (kind + de-slugged basename), NOT the raw path.
      expect(find.text('preference'), findsOneWidget);
      expect(
        find.text('Standing instruction archive research'),
        findsOneWidget,
      );
      expect(
        find.text('memory/preference/standing-instruction-archive-research.md'),
        findsNothing,
      );

      // Empty-but-recorded state says so explicitly.
      controller.setMemoryProvenanceForTest('s1', {
        'recorded': true,
        'memoryIds': <String>[],
        'notePaths': <String>[],
      });
      await tester.pump();
      expect(
        find.byKey(const ValueKey('context-memories-none')),
        findsOneWidget,
      );

      // Never recorded → no section at all.
      controller.setMemoryProvenanceForTest('s1', {'recorded': false});
      await tester.pump();
      expect(find.text('Memories used'), findsNothing);

      // Flush any rebuild-triggered unawaited controller fetches (the stub's
      // noSuchMethod rejects them) BEFORE teardown, so nothing lands during a
      // later test and retro-fails this one.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)),
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'Context tab shows cost, token breakdown, model and message count',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );

      await tester.runAsync(() async {
        await controller.initialize();
        controller.setActiveSessionForTest('s1', _makeSession('s1'));
        // Seed one ASSISTANT message carrying cost + a full token breakdown.
        _seedMessage(
          controller,
          sessionId: 's1',
          messageId: 'm1',
          cost: 0.0035,
          tokens: const {
            'input': 100,
            'output': 50,
            'reasoning': 10,
            'cache': {'read': 20, 'write': 5},
          },
        );
      });

      await tester
          .pumpWidget(await _buildTestApp(agentsController: controller));
      await tester.pump();

      // Context tab is the default tab on the inspector panel.
      expect(find.byKey(const ValueKey('context-cost')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('context-cost'))).data,
        contains('0.0035'),
      );
      expect(
        find.byKey(const ValueKey('context-tokens-input')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('context-tokens-output')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('context-model')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('context-message-count')),
        findsOneWidget,
      );

      // Teardown: detach the tree so widget-owned timers dispose before the
      // controller's stuck-check timer is cancelled.
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'Context tab with no messages keeps empty state and omits cost row',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );

      await tester.runAsync(() async {
        await controller.initialize();
        controller.setActiveSessionForTest('s1', _makeSession('s1'));
      });

      await tester
          .pumpWidget(await _buildTestApp(agentsController: controller));
      await tester.pump();

      // No messages → existing empty state, no cost row.
      expect(find.text('No messages yet'), findsOneWidget);
      expect(find.byKey(const ValueKey('context-cost')), findsNothing);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );
}
