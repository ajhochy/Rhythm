/// Follow-up to #904: activity log rows were not tappable at all — a user
/// looking at "what happened on this run" had no way to open that run's
/// session transcript. Adds an onTap to _ActivityLogRow that reuses the same
/// NotificationsController.navigateTo('agentSession', id) + AppShell
/// pending-navigation mechanism as tapping a notification (#815), and closes
/// the detail sheet so the user lands cleanly on the Agents tab.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_schedules/controllers/agent_schedules_controller.dart';
import 'package:rhythm_desktop/features/agent_schedules/data/agent_schedules_data_source.dart';
import 'package:rhythm_desktop/features/agent_schedules/models/agent_scheduled_task.dart';
import 'package:rhythm_desktop/features/agent_schedules/repositories/agent_schedules_repository.dart';
import 'package:rhythm_desktop/features/agent_schedules/views/agent_schedules_view.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

class _FakeSchedulesDataSource extends AgentSchedulesDataSource {
  _FakeSchedulesDataSource(this._tasks, this._runs);

  final List<AgentScheduledTask> _tasks;
  final List<AgentSession> _runs;

  @override
  Future<List<AgentScheduledTask>> list() async => List.of(_tasks);

  @override
  Future<List<AgentSession>> listRuns(String scheduledTaskId) async =>
      List.of(_runs);
}

class _EmptyAgentConfigsDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [];
}

const _kEpoch = '1970-01-01T00:00:00.000Z';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
      'tapping an activity log row sets pending navigation to that session and closes the sheet',
      (tester) async {
    final task = AgentScheduledTask(
      id: 't1',
      name: 'Sunday Prep',
      scheduleType: 'daily',
      scheduledTime: '09:00',
      timezone: 'America/Los_Angeles',
      prompt: 'do something',
      agentKind: 'opencode',
      enabled: true,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );
    final run = AgentSession(
      id: 'ses_abc123',
      agentId: 'opencode',
      name: 'Run ses_abc123',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      lastPreview: 'Staffing complete, no gaps found.',
      createdAt: DateTime.parse(_kEpoch),
      updatedAt: DateTime.parse(_kEpoch),
    );

    final schedulesController = AgentSchedulesController(
      AgentSchedulesRepository(_FakeSchedulesDataSource([task], [run])),
    );
    await schedulesController.refresh();
    final configsController = AgentConfigsController(
      AgentConfigsRepository(_EmptyAgentConfigsDataSource()),
    );
    final notificationsController = NotificationsController(
        NotificationsRepository(NotificationsDataSource()));

    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AgentSchedulesController>.value(
          value: schedulesController,
        ),
        ChangeNotifierProvider<AgentConfigsController>.value(
          value: configsController,
        ),
        ChangeNotifierProvider<NotificationsController>.value(
          value: notificationsController,
        ),
      ],
      child: const MaterialApp(home: AgentSchedulesView()),
    ));
    await tester.pump();

    await tester.tap(find.text('Sunday Prep'));
    await tester.pumpAndSettle();
    expect(find.text('ACTIVITY'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('activity-log-row-ses_abc123')));
    await tester.pumpAndSettle();

    expect(
        notificationsController.pendingNavigation?.entityType, 'agentSession');
    expect(notificationsController.pendingNavigation?.entityId, 'ses_abc123');
    // The detail sheet closed on navigation.
    expect(find.text('ACTIVITY'), findsNothing);

    schedulesController.dispose();
    configsController.dispose();
    notificationsController.dispose();
  });
}
