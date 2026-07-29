/// #904 — Scheduled Tasks detail sheet: activity log.
///
/// Verifies the detail sheet's ACTIVITY section renders recent runs (status +
/// preview text) fetched via AgentSchedulesController.listRuns, and shows a
/// clean "No runs yet" state when there are none.
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

class _FakeSchedulesDataSource extends AgentSchedulesDataSource {
  _FakeSchedulesDataSource(this._tasks, {List<AgentSession> runs = const []})
    : _runs = runs;

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

AgentScheduledTask _task(String id, String name) => AgentScheduledTask(
  id: id,
  name: name,
  scheduleType: 'daily',
  scheduledTime: '09:00',
  timezone: 'America/Los_Angeles',
  prompt: 'do something',
  agentKind: 'opencode',
  enabled: true,
  createdAt: _kEpoch,
  updatedAt: _kEpoch,
);

AgentSession _run(
  String id, {
  required AgentSessionStatus status,
  String? lastPreview,
}) => AgentSession(
  id: id,
  agentId: 'opencode',
  name: 'Run $id',
  cwd: '/tmp',
  status: status,
  lastPreview: lastPreview,
  createdAt: DateTime.parse(_kEpoch),
  updatedAt: DateTime.parse(_kEpoch),
);

Widget _buildApp({
  required AgentSchedulesController schedulesController,
  required AgentConfigsController configsController,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentSchedulesController>.value(
        value: schedulesController,
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: configsController,
      ),
    ],
    child: const MaterialApp(home: AgentSchedulesView()),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> openDetailSheet(WidgetTester tester, String taskName) async {
    await tester.tap(find.text(taskName));
    await tester.pumpAndSettle();
  }

  testWidgets('shows recent runs with status and preview text', (tester) async {
    final schedulesController = AgentSchedulesController(
      AgentSchedulesRepository(
        _FakeSchedulesDataSource(
          [_task('t1', 'Sunday Prep')],
          runs: [
            _run(
              'r1',
              status: AgentSessionStatus.idle,
              lastPreview: 'Staffing complete, no gaps found.',
            ),
            _run(
              'r2',
              status: AgentSessionStatus.error,
              lastPreview: 'Run timed out after 50ms',
            ),
          ],
        ),
      ),
    );
    final configsController = AgentConfigsController(
      AgentConfigsRepository(_EmptyAgentConfigsDataSource()),
    );
    await schedulesController.refresh();

    await tester.pumpWidget(
      _buildApp(
        schedulesController: schedulesController,
        configsController: configsController,
      ),
    );
    await tester.pump();

    await openDetailSheet(tester, 'Sunday Prep');

    expect(find.text('ACTIVITY'), findsOneWidget);
    expect(find.text('Staffing complete, no gaps found.'), findsOneWidget);
    expect(find.text('Run timed out after 50ms'), findsOneWidget);

    schedulesController.dispose();
    configsController.dispose();
  });

  testWidgets('shows "No runs yet" when the task has never run', (
    tester,
  ) async {
    final schedulesController = AgentSchedulesController(
      AgentSchedulesRepository(
        _FakeSchedulesDataSource([_task('t1', 'Sunday Prep')]),
      ),
    );
    final configsController = AgentConfigsController(
      AgentConfigsRepository(_EmptyAgentConfigsDataSource()),
    );
    await schedulesController.refresh();

    await tester.pumpWidget(
      _buildApp(
        schedulesController: schedulesController,
        configsController: configsController,
      ),
    );
    await tester.pump();

    await openDetailSheet(tester, 'Sunday Prep');

    expect(find.text('No runs yet.'), findsOneWidget);

    schedulesController.dispose();
    configsController.dispose();
  });
}
