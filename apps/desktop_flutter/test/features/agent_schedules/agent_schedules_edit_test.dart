/// Widget tests for the edit-mode behaviour of _ScheduleFormSheet inside
/// AgentSchedulesView.
///
/// Asserts:
///   1. Opening the form sheet in edit mode pre-fills name and prompt from the
///      existing task.
///   2. Tapping "Save" in edit mode calls controller.update(id, ...) and does
///      NOT call controller.create(...).
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

// ---------------------------------------------------------------------------
// Fake data sources
// ---------------------------------------------------------------------------

/// A schedules data source that records what update/create were called with.
class _FakeSchedulesDataSource extends AgentSchedulesDataSource {
  final List<AgentScheduledTask> _tasks;

  _FakeSchedulesDataSource(this._tasks);

  String? lastUpdatedId;
  Map<String, dynamic>? lastUpdatedPatch;
  bool createCalled = false;

  @override
  Future<List<AgentScheduledTask>> list() async => List.of(_tasks);

  @override
  Future<AgentScheduledTask> create(Map<String, dynamic> input) async {
    createCalled = true;
    return _tasks.first;
  }

  @override
  Future<AgentScheduledTask> update(
    String id,
    Map<String, dynamic> patch,
  ) async {
    lastUpdatedId = id;
    lastUpdatedPatch = patch;
    // Return the same task with updated name/prompt so the controller list
    // stays consistent.
    return AgentScheduledTask(
      id: id,
      name: (patch['name'] as String?) ?? _tasks.first.name,
      scheduleType: (patch['scheduleType'] as String?) ?? 'daily',
      timezone: (patch['timezone'] as String?) ?? 'America/Los_Angeles',
      prompt: (patch['prompt'] as String?) ?? _tasks.first.prompt,
      agentKind: 'opencode',
      enabled: (patch['enabled'] as bool?) ?? true,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );
  }

  @override
  Future<void> delete(String id) async {}

  @override
  Future<AgentScheduledTask> triggerNow(String id) async => _tasks.first;
}

/// An agent-configs data source that returns an empty list (no agent profiles
/// in the picker) so the test doesn't need real agent data.
class _EmptyAgentConfigsDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _kEpoch = '1970-01-01T00:00:00.000Z';
const _kTaskId = 'task-abc-123';
const _kTaskName = 'My Test Task';
const _kTaskPrompt = 'Do something useful every day';

AgentScheduledTask _makeTask() => AgentScheduledTask(
  id: _kTaskId,
  name: _kTaskName,
  scheduleType: 'daily',
  scheduledTime: '09:00',
  timezone: 'America/Los_Angeles',
  prompt: _kTaskPrompt,
  agentKind: 'opencode',
  enabled: true,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('_ScheduleFormSheet — edit mode', () {
    late _FakeSchedulesDataSource dataSource;
    late AgentSchedulesController schedulesController;
    late AgentConfigsController configsController;

    setUp(() {
      final task = _makeTask();
      dataSource = _FakeSchedulesDataSource([task]);
      schedulesController = AgentSchedulesController(
        AgentSchedulesRepository(dataSource),
      );
      configsController = AgentConfigsController(
        AgentConfigsRepository(_EmptyAgentConfigsDataSource()),
      );
    });

    tearDown(() {
      schedulesController.dispose();
      configsController.dispose();
    });

    testWidgets('edit mode pre-fills name and prompt from existing task', (
      tester,
    ) async {
      // Load tasks into controller so the list view renders the tile.
      await schedulesController.refresh();

      await tester.pumpWidget(
        _buildApp(
          schedulesController: schedulesController,
          configsController: configsController,
        ),
      );
      await tester.pump();

      // Tap the task tile to open the detail sheet.
      await tester.tap(find.text(_kTaskName));
      await tester.pumpAndSettle();

      // Tap the Edit button in the detail sheet.
      final editButton = find.byKey(const ValueKey('edit-schedule-button'));
      expect(
        editButton,
        findsOneWidget,
        reason: 'Edit button should appear in the detail sheet',
      );
      await tester.tap(editButton);
      await tester.pumpAndSettle();

      // The form sheet should now be visible in edit mode.
      expect(
        find.text('Edit Scheduled Task'),
        findsOneWidget,
        reason: 'Form sheet title should read "Edit Scheduled Task"',
      );

      // The name field should be pre-filled.
      final nameField = find.widgetWithText(TextFormField, _kTaskName);
      expect(
        nameField,
        findsOneWidget,
        reason: 'Name field should be pre-filled with existing task name',
      );

      // The prompt field should be pre-filled.
      expect(
        find.text(_kTaskPrompt),
        findsOneWidget,
        reason: 'Prompt field should be pre-filled with existing task prompt',
      );
    });

    testWidgets(
      'tapping Save in edit mode calls controller.update(id) not create',
      (tester) async {
        await schedulesController.refresh();

        await tester.pumpWidget(
          _buildApp(
            schedulesController: schedulesController,
            configsController: configsController,
          ),
        );
        await tester.pump();

        // Open detail sheet.
        await tester.tap(find.text(_kTaskName));
        await tester.pumpAndSettle();

        // Tap Edit.
        await tester.tap(find.byKey(const ValueKey('edit-schedule-button')));
        await tester.pumpAndSettle();

        // Verify we're in the form sheet (edit mode).
        expect(find.text('Edit Scheduled Task'), findsOneWidget);

        // Tap Save (the submit button label is "Save" in edit mode).
        final saveButton = find.widgetWithText(FilledButton, 'Save');
        expect(
          saveButton,
          findsOneWidget,
          reason: '"Save" FilledButton should appear in edit mode',
        );
        await tester.tap(saveButton);
        await tester.pumpAndSettle();

        // update() should have been called with the task's id.
        expect(
          dataSource.lastUpdatedId,
          equals(_kTaskId),
          reason: 'update() should have been called with the task id',
        );

        // create() must NOT have been called.
        expect(
          dataSource.createCalled,
          isFalse,
          reason: 'create() must not be called when saving an edit',
        );
      },
    );
  });
}
