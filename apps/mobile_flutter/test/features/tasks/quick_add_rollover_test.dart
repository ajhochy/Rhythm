import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_mobile/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_mobile/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_mobile/features/tasks/data/tasks_data_source.dart';
import 'package:rhythm_mobile/features/tasks/models/task.dart';
import 'package:rhythm_mobile/features/tasks/repositories/tasks_repository.dart';
import 'package:rhythm_mobile/features/tasks/views/quick_add_view.dart';

class _MutableClock {
  _MutableClock(this.value);

  DateTime value;

  DateTime call() => value;
}

class _RecordingTasksDataSource extends TasksDataSource {
  _RecordingTasksDataSource() : super(baseUrl: 'http://unused.invalid');

  String? createdDueDate;
  var createCalls = 0;

  @override
  Future<Task> create({
    required String title,
    String? notes,
    String? dueDate,
  }) async {
    createCalls++;
    createdDueDate = dueDate;
    return Task(
      id: 'task-1',
      title: title,
      notes: notes,
      dueDate: dueDate,
      status: TaskStatus.open,
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    );
  }
}

Future<void> _pumpQuickAdd(
  WidgetTester tester, {
  required _MutableClock clock,
  required _RecordingTasksDataSource dataSource,
  required GlobalKey<QuickAddViewState> key,
}) async {
  final controller = TasksController(TasksRepository(dataSource));
  await tester.pumpWidget(
    ChangeNotifierProvider<TasksController>.value(
      value: controller,
      child: MaterialApp(
        theme: ThemeData(
          extensions: const <ThemeExtension<dynamic>>[
            RhythmColorRoles.light,
          ],
        ),
        home: QuickAddView(
          key: key,
          now: clock.call,
          onTaskCreated: () {},
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _saveTask(WidgetTester tester, String title) async {
  await tester.enterText(find.byType(TextField).first, title);
  await tester.pump();
  await tester.tap(find.text('Save'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'retained Quick Add state advances its implicit due date on tab re-entry',
    (tester) async {
      final clock = _MutableClock(DateTime(2026, 5, 5, 23, 59));
      final dataSource = _RecordingTasksDataSource();
      final key = GlobalKey<QuickAddViewState>();
      await _pumpQuickAdd(
        tester,
        clock: clock,
        dataSource: dataSource,
        key: key,
      );

      expect(find.text('May 5, 2026'), findsOneWidget);

      clock.value = DateTime(2026, 5, 6, 0, 1);
      key.currentState!.requestTitleFocus();
      await tester.pump();

      expect(find.text('May 6, 2026'), findsOneWidget);

      await _saveTask(tester, 'Rollover task');
      expect(dataSource.createCalls, 1);
      expect(dataSource.createdDueDate, '2026-05-06');
    },
  );

  testWidgets(
    'foreground resume advances the implicit due date after midnight',
    (tester) async {
      final clock = _MutableClock(DateTime(2026, 5, 5, 23, 59));
      final dataSource = _RecordingTasksDataSource();
      final key = GlobalKey<QuickAddViewState>();
      await _pumpQuickAdd(
        tester,
        clock: clock,
        dataSource: dataSource,
        key: key,
      );

      clock.value = DateTime(2026, 5, 6, 0, 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(find.text('May 6, 2026'), findsOneWidget);
    },
  );

  testWidgets(
    'an explicitly cleared due date survives rollover',
    (tester) async {
      final clock = _MutableClock(DateTime(2026, 5, 5, 23, 59));
      final dataSource = _RecordingTasksDataSource();
      final key = GlobalKey<QuickAddViewState>();
      await _pumpQuickAdd(
        tester,
        clock: clock,
        dataSource: dataSource,
        key: key,
      );

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();
      expect(find.text('No due date'), findsOneWidget);

      clock.value = DateTime(2026, 5, 6, 0, 1);
      key.currentState!.requestTitleFocus();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(find.text('No due date'), findsOneWidget);

      await _saveTask(tester, 'No-date rollover task');
      expect(dataSource.createCalls, 1);
      expect(dataSource.createdDueDate, isNull);
    },
  );
}
