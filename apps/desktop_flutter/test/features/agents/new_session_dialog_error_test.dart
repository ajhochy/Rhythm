import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
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
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null);

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
  bool isAgentAvailable(String kind) => kind == 'claude-code';

  @override
  Future<void> initialize() async {}
}

/// Repository that throws an [AppError] when [createSession] is called.
/// [statusCode] controls whether it's a 4xx or 5xx error.
class _ErrorAgentsRepository implements AgentsRepository {
  _ErrorAgentsRepository({required this.statusCode, required this.message});

  final int statusCode;
  final String message;

  final StreamController<AgentWsMessage> _msgController =
      StreamController.broadcast();
  final StreamController<bool> _connectivityController =
      StreamController.broadcast();

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
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions() async => [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    throw UnimplementedError();
  }

  @override
  Future<AgentSession> createSession({
    required String agentId,
    String? taskId,
    required String cwd,
    required String name,
  }) async {
    throw AppError(
      message,
      code: statusCode < 500 ? 'BAD_REQUEST' : null,
      statusCode: statusCode,
    );
  }

  @override
  Future<void> closeSession(String id) async {}

  @override
  Future<AgentSession> resumeSession(String id) async {
    throw UnimplementedError();
  }

  @override
  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) async {
    return [];
  }
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

Future<AgentConfigsController> _makeAgentConfigsController() async {
  final dataSource = _FakeAgentConfigsDataSource([_claudeCodeConfig]);
  final repository = AgentConfigsRepository(dataSource);
  final controller = AgentConfigsController(repository);
  await controller.refresh();
  return controller;
}

Future<Widget> _buildTestApp({
  required AgentsController agentsController,
}) async {
  final agentServerController = _ReadyAgentServerController();
  final agentConfigsController = await _makeAgentConfigsController();
  final tasksController = TasksController(
    TasksRepository(_EmptyTasksLocalDataSource()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: agentServerController,
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
      ChangeNotifierProvider<AgentsController>.value(value: agentsController),
      ChangeNotifierProvider<TasksController>.value(value: tasksController),
    ],
    child: const MaterialApp(home: Scaffold(body: AgentsView())),
  );
}

class _EmptyTasksLocalDataSource extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<AgentsController> makeController(_ErrorAgentsRepository repo) async {
    final controller = AgentsController(
      repo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
    return controller;
  }

  Future<void> openDialogAndSubmit(WidgetTester tester) async {
    // Wait for AgentConfigsController to load configs.
    await tester.pumpAndSettle();

    // Tap the "New" button to open the dialog.
    await tester.tap(find.text('New'));
    await tester.pumpAndSettle();

    // Fill in the session name (required to enable Start button).
    await tester.enterText(
      find.widgetWithText(TextField, 'e.g. Fix auth bug'),
      'Test session',
    );
    await tester.pump();

    // Tap Start.
    await tester.tap(find.text('Start'));
    await tester.pumpAndSettle();
  }

  testWidgets('4xx error renders server error.message verbatim', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final repo = _ErrorAgentsRepository(
      statusCode: 400,
      message: "agent not configured: 'claude'",
    );
    final controller = await makeController(repo);

    await tester.pumpWidget(
      await _buildTestApp(agentsController: controller),
    );
    await openDialogAndSubmit(tester);

    expect(find.textContaining('agent not configured'), findsOneWidget);
    // Generic server message must NOT appear for 4xx.
    expect(
      find.textContaining('Something went wrong on the server'),
      findsNothing,
    );
  });

  testWidgets(
    '5xx error shows generic message; raw detail is behind disclosure',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      const rawMessage = 'Internal database error: connection reset';
      final repo = _ErrorAgentsRepository(statusCode: 500, message: rawMessage);
      final controller = await makeController(repo);

      await tester.pumpWidget(
        await _buildTestApp(agentsController: controller),
      );
      await openDialogAndSubmit(tester);

      // Generic top-line message should be visible.
      expect(
        find.textContaining('Something went wrong on the server'),
        findsOneWidget,
      );
      // Raw server message must NOT be immediately visible (behind ExpansionTile).
      expect(find.textContaining(rawMessage), findsNothing);
    },
  );
}
