/// Mounted-surface test for the resizable inspector side panel.
///
/// Pumps the REAL AgentsView with a selected session so SessionSidePanel +
/// the drag handle mount, then:
///   - asserts the panel renders at the controller's panelWidth (default 320)
///   - drags the handle LEFT and asserts the panel width INCREASED (panel is
///     on the right, so dragging left widens it)
///
/// Backed by AgentsController.panelWidth / setPanelWidth(double).
///
/// Run with:
///   flutter test test/features/agents/inspector_resize_mounted_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
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
  bool send(Map<String, dynamic> msg) => true;

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

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

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

double _panelWidth(WidgetTester tester) {
  final size = tester.getSize(find.byKey(const ValueKey('inspector-panel')));
  return size.width;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'inspector panel renders at controller width and widens when handle '
    'dragged left',
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
      // #905 — the panel now defaults to collapsed; this test exercises the
      // resize handle, so expand it explicitly (after the initial pump,
      // since AgentsController.initialize() fires an unawaited
      // loadInspectorPrefs() that would otherwise race an earlier explicit set).
      await controller.setPanelCollapsed(false);
      await tester.pump();

      // Default width 320.
      expect(find.byKey(const ValueKey('inspector-panel')), findsOneWidget);
      expect(_panelWidth(tester), 320);
      expect(controller.panelWidth, 320);

      // Drag the handle LEFT by 80px → panel should grow to 400.
      expect(
        find.byKey(const ValueKey('inspector-resize-handle')),
        findsOneWidget,
      );
      await tester.drag(
        find.byKey(const ValueKey('inspector-resize-handle')),
        const Offset(-80, 0),
      );
      await tester.pumpAndSettle();

      expect(controller.panelWidth, greaterThan(320));
      expect(controller.panelWidth, 400);
      expect(_panelWidth(tester), 400);

      // Teardown.
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );
}
