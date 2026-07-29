/// #902 — Scheduled Tasks page: search, sort, and human-readable schedule
/// display.
///
/// Asserts:
///   1. The search box filters tasks by name (live substring match).
///   2. Empty search / no-results state renders cleanly.
///   3. Each row shows an enabled/disabled badge.
///   4. A cron schedule renders as a human-readable description.
///   5. humanizeCronExpression covers the documented common patterns and
///      falls back to the raw expression for anything else.
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

class _FakeSchedulesDataSource extends AgentSchedulesDataSource {
  _FakeSchedulesDataSource(this._tasks);

  final List<AgentScheduledTask> _tasks;

  @override
  Future<List<AgentScheduledTask>> list() async => List.of(_tasks);

  @override
  Future<AgentScheduledTask> create(Map<String, dynamic> input) async =>
      _tasks.first;

  @override
  Future<AgentScheduledTask> update(
    String id,
    Map<String, dynamic> patch,
  ) async => _tasks.first;

  @override
  Future<void> delete(String id) async {}

  @override
  Future<AgentScheduledTask> triggerNow(String id) async => _tasks.first;
}

class _EmptyAgentConfigsDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [];
}

const _kEpoch = '1970-01-01T00:00:00.000Z';

AgentScheduledTask _task(
  String id,
  String name, {
  bool enabled = true,
  String scheduleType = 'daily',
  String? scheduledTime,
  String? cronExpression,
}) => AgentScheduledTask(
  id: id,
  name: name,
  scheduleType: scheduleType,
  scheduledTime: scheduledTime,
  cronExpression: cronExpression,
  timezone: 'America/Los_Angeles',
  prompt: 'do something',
  agentKind: 'opencode',
  enabled: enabled,
  createdAt: _kEpoch,
  updatedAt: _kEpoch,
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

  group('AgentSchedulesView — search + badges (#902)', () {
    late AgentSchedulesController schedulesController;
    late AgentConfigsController configsController;

    setUp(() {
      final tasks = [
        _task('t1', 'Morning Briefing', enabled: true, scheduledTime: '09:00'),
        _task('t2', 'Evening Wrap-up', enabled: false, scheduledTime: '18:00'),
      ];
      schedulesController = AgentSchedulesController(
        AgentSchedulesRepository(_FakeSchedulesDataSource(tasks)),
      );
      configsController = AgentConfigsController(
        AgentConfigsRepository(_EmptyAgentConfigsDataSource()),
      );
    });

    tearDown(() {
      schedulesController.dispose();
      configsController.dispose();
    });

    testWidgets('search box filters tasks by name', (tester) async {
      await schedulesController.refresh();
      await tester.pumpWidget(
        _buildApp(
          schedulesController: schedulesController,
          configsController: configsController,
        ),
      );
      await tester.pump();

      expect(find.text('Morning Briefing'), findsOneWidget);
      expect(find.text('Evening Wrap-up'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('schedule-search-field')),
        'morning',
      );
      await tester.pump();

      expect(find.text('Morning Briefing'), findsOneWidget);
      expect(find.text('Evening Wrap-up'), findsNothing);
    });

    testWidgets('no-results state renders cleanly for a non-matching search', (
      tester,
    ) async {
      await schedulesController.refresh();
      await tester.pumpWidget(
        _buildApp(
          schedulesController: schedulesController,
          configsController: configsController,
        ),
      );
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('schedule-search-field')),
        'no such task',
      );
      await tester.pump();

      expect(find.text('Morning Briefing'), findsNothing);
      expect(find.textContaining('No tasks match'), findsOneWidget);
    });

    testWidgets('each row shows an enabled/disabled badge', (tester) async {
      await schedulesController.refresh();
      await tester.pumpWidget(
        _buildApp(
          schedulesController: schedulesController,
          configsController: configsController,
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const ValueKey('schedule-badge-enabled')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('schedule-badge-disabled')),
        findsOneWidget,
      );
    });
  });

  group('humanizeCronExpression (#902)', () {
    test('0 9 * * * -> Daily at 9am', () {
      expect(humanizeCronExpression('0 9 * * *'), 'Daily at 9am');
    });

    test('30 9 * * * -> Daily at 9:30am', () {
      expect(humanizeCronExpression('30 9 * * *'), 'Daily at 9:30am');
    });

    test('0 9 */6 * * -> Every 6 days at 9am (the issue\'s own example)', () {
      expect(humanizeCronExpression('0 9 */6 * *'), 'Every 6 days at 9am');
    });

    test('0 22 * * 6 -> Every Saturday at 10pm', () {
      expect(humanizeCronExpression('0 22 * * 6'), 'Every Saturday at 10pm');
    });

    test('0 9 15 * * -> Monthly on day 15 at 9am', () {
      expect(humanizeCronExpression('0 9 15 * *'), 'Monthly on day 15 at 9am');
    });

    test('falls back to the raw expression for an unrecognized pattern', () {
      expect(humanizeCronExpression('0 9 1,15 * *'), '0 9 1,15 * *');
      expect(humanizeCronExpression('*/15 * * * *'), '*/15 * * * *');
      expect(humanizeCronExpression('garbage'), 'garbage');
    });
  });
}
