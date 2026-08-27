import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
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

class _ApiServer extends ApiServerService {
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _AgentServer extends AgentServerController {
  _AgentServer() : super(_ApiServer());
  @override
  AgentServerStatus get status => AgentServerStatus.ready;
  @override
  bool get isReady => true;
  @override
  bool get hasAnyAgent => true;
}

class _Repository implements AgentsRepository {
  @override
  Stream<AgentWsMessage> get messages => const Stream.empty();
  @override
  Stream<bool> get connectivityStream => const Stream.empty();
  @override
  bool get isConnected => true;
  @override
  Future<void> dispose() async {}
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Notifications extends NotificationsController {
  _Notifications()
      : super(NotificationsRepository(
            NotificationsDataSource(baseUrl: 'http://unused')));
}

class _ProjectsDataSource extends AgentProjectsRemoteDataSource {
  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async => [];
}

class _TasksDataSource extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
}

void main() {
  setUpAll(() async {
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('fonts/inter/Inter-Regular.otf'));
    await inter.load();
  });

  testWidgets(
      'issue-1457-c5: bridge outage shows reconnecting without failing sessions and recovery clears it',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final agentServer = _AgentServer();
    final controller = AgentsController(
      _Repository(),
      agentServer,
      LocalNotificationService(),
      _Notifications(),
    );
    final configs = AgentConfigsController(
      AgentConfigsRepository(AgentConfigsDataSource()),
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AgentServerController>.value(
              value: agentServer),
          ChangeNotifierProvider<AgentsController>.value(value: controller),
          ChangeNotifierProvider<AgentConfigsController>.value(value: configs),
          ChangeNotifierProvider<TasksController>.value(
            value: TasksController(TasksRepository(_TasksDataSource())),
          ),
          ChangeNotifierProvider<AgentProjectsController>.value(
            value: AgentProjectsController(
              AgentProjectsRepository(_ProjectsDataSource()),
            ),
          ),
        ],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          home: const AgentsView(),
        ),
      ),
    );

    controller.handleWsMessageForTest(AgentWsMessage.parse({
      'v': 1,
      'type': 'bridge.status',
      'status': 'reconnecting',
      'message': 'Agent updates interrupted — reconnecting…',
      'retryDelayMs': 1000,
      'attempt': 1,
    }));
    await tester.pump();

    expect(
        find.text('Agent updates interrupted — reconnecting…'), findsOneWidget);
    expect(
        controller.sessions.where((session) => session.status.name == 'error'),
        isEmpty);
    await expectLater(
      find.byType(AgentsView),
      matchesGoldenFile('goldens/issue_1457_bridge_reconnecting.png'),
    );

    controller.handleWsMessageForTest(AgentWsMessage.parse({
      'v': 1,
      'type': 'bridge.status',
      'status': 'ready',
      'message': 'Agent updates reconnected.',
    }));
    await tester.pump();

    expect(
        find.text('Agent updates interrupted — reconnecting…'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
}
