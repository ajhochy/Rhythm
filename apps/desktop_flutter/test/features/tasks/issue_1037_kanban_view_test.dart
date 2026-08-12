import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/services/server_config_service.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_controller.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_data_source.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_repository.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';
import 'package:rhythm_desktop/features/tasks/views/tasks_kanban_view.dart';
import 'package:rhythm_desktop/features/tasks/views/tasks_view.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1037-c1: four columns group every existing task by status',
    (tester) async {
      final dataSource = _FakeTasksDataSource(tasks: _tasksByStatus());
      final controller = TasksController(TasksRepository(dataSource));
      await controller.load();

      await _pumpBoard(tester, controller);

      expect(find.byKey(const ValueKey('kanban-column-open')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('kanban-column-in_progress')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('kanban-column-waiting_for_reply')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('kanban-column-done')), findsOneWidget);
      for (final task in _tasksByStatus()) {
        expect(
          find.byKey(ValueKey('kanban-card-${task.id}')),
          findsOneWidget,
        );
      }
      expect(find.text('07/31/2026'), findsOneWidget);
      expect(find.text('codex'), findsOneWidget);
    },
  );

  testWidgets('issue-1037-c7: Tasks view toggles from list to Kanban board', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1600, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final controller = TasksController(
      TasksRepository(_FakeTasksDataSource(tasks: _tasksByStatus())),
    );
    final workspaceController = _NoopWorkspaceController(
      WorkspaceRepository(
        WorkspaceDataSource(baseUrl: 'http://example.invalid'),
      ),
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<TasksController>.value(value: controller),
          ChangeNotifierProvider<WorkspaceController>.value(
            value: workspaceController,
          ),
          ChangeNotifierProvider(create: (_) => ServerConfigService()),
        ],
        child: const MaterialApp(
          home: Scaffold(body: TasksView()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tasks-kanban-board')), findsNothing);
    await tester.tap(find.text('Board'));
    await tester.pumpAndSettle();

    // Board must also survive a small-window relayout without overflow.
    await tester.binding.setSurfaceSize(const Size(800, 600));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tasks-kanban-board')), findsOneWidget);
    expect(find.byKey(const ValueKey('kanban-column-done')), findsOneWidget);
  });

  testWidgets(
    'issue-1037-c2: accepting a dragged card sends exactly one target status update',
    (tester) async {
      final dataSource = _FakeTasksDataSource(
        tasks: [_task('drag-me', TaskStatus.open, title: 'Drag me')],
      );
      final controller = TasksController(TasksRepository(dataSource));
      await controller.load();
      await _pumpBoard(tester, controller);

      final card = find.byKey(const ValueKey('kanban-draggable-drag-me'));
      final target =
          find.byKey(const ValueKey('kanban-column-waiting_for_reply'));
      final gesture = await tester.startGesture(tester.getCenter(card));
      await tester.pump(kLongPressTimeout + const Duration(milliseconds: 50));
      await gesture.moveTo(tester.getCenter(target));
      await tester.pump();
      await gesture.up();
      await tester.pump();

      expect(dataSource.updateCalls, 1);
      expect(dataSource.updatedTaskId, 'drag-me');
      expect(dataSource.updatedStatus, 'waiting_for_reply');
      expect(controller.tasks.single.status, TaskStatus.waitingForReply);
    },
  );

  testWidgets('issue-1037-c3: controller loading state is rendered', (
    tester,
  ) async {
    final dataSource = _FakeTasksDataSource(
      tasks: const [],
      loadCompleter: Completer<List<Task>>(),
    );
    final controller = TasksController(TasksRepository(dataSource));
    unawaited(controller.load());

    await _pumpBoard(tester, controller);

    expect(
      find.byKey(const ValueKey('kanban-loading-state')),
      findsOneWidget,
    );
    expect(find.text('Loading tasks...'), findsOneWidget);
    dataSource.loadCompleter!.complete(const []);
    await tester.pump();
  });

  testWidgets('issue-1037-c4: controller error state is rendered with retry', (
    tester,
  ) async {
    final dataSource = _FakeTasksDataSource(
      tasks: const [],
      loadError: StateError('offline'),
    );
    final controller = TasksController(TasksRepository(dataSource));
    await controller.load();

    await _pumpBoard(tester, controller);

    expect(find.byKey(const ValueKey('kanban-error-state')), findsOneWidget);
    expect(find.text('Unable to load tasks'), findsOneWidget);
    expect(find.textContaining('offline'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('issue-1037-c5: each empty column has a quiet empty state', (
    tester,
  ) async {
    final controller = TasksController(
      TasksRepository(_FakeTasksDataSource(tasks: const [])),
    );
    await controller.load();

    await _pumpBoard(tester, controller);

    expect(find.text('No tasks in Open'), findsOneWidget);
    expect(find.text('No tasks in In progress'), findsOneWidget);
    expect(find.text('No tasks in Waiting for reply'), findsOneWidget);
    expect(find.text('No tasks in Done'), findsOneWidget);
  });

  testWidgets('issue-1037-c6: no task card appears in more than one column', (
    tester,
  ) async {
    final tasks = [
      _task('unique-a', TaskStatus.open, title: 'Unique A'),
      _task('unique-b', TaskStatus.done, title: 'Unique B'),
    ];
    final controller = TasksController(
      TasksRepository(_FakeTasksDataSource(tasks: tasks)),
    );
    await controller.load();

    await _pumpBoard(tester, controller);

    for (final task in tasks) {
      expect(
        find.byKey(ValueKey('kanban-card-${task.id}')),
        findsOneWidget,
        reason: '${task.id} must be rendered in exactly one status column',
      );
    }
  });

  testWidgets(
    'issue-1037-c8: cards sort by scheduled order and then due date',
    (tester) async {
      final tasks = [
        _task(
          'later-order',
          TaskStatus.open,
          title: 'Later order',
          scheduledOrder: 2,
          dueDate: '2026-07-01',
        ),
        _task(
          'later-due',
          TaskStatus.open,
          title: 'Later due',
          scheduledOrder: 1,
          dueDate: '2026-07-20',
        ),
        _task(
          'earlier-due',
          TaskStatus.open,
          title: 'Earlier due',
          scheduledOrder: 1,
          dueDate: '2026-07-10',
        ),
      ];
      final controller = TasksController(
        TasksRepository(_FakeTasksDataSource(tasks: tasks)),
      );
      await controller.load();

      await _pumpBoard(tester, controller);

      final earlierDueY = tester
          .getTopLeft(
            find.byKey(const ValueKey('kanban-card-earlier-due')),
          )
          .dy;
      final laterDueY = tester
          .getTopLeft(
            find.byKey(const ValueKey('kanban-card-later-due')),
          )
          .dy;
      final laterOrderY = tester
          .getTopLeft(
            find.byKey(const ValueKey('kanban-card-later-order')),
          )
          .dy;
      expect(earlierDueY, lessThan(laterDueY));
      expect(laterDueY, lessThan(laterOrderY));
    },
  );
}

Future<void> _pumpBoard(
  WidgetTester tester,
  TasksController controller,
) async {
  await tester.binding.setSurfaceSize(const Size(1400, 800));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SizedBox.expand(
          child: TasksKanbanView(
            controller: controller,
            tasks: controller.tasks,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

List<Task> _tasksByStatus() => [
      _task(
        'open-task',
        TaskStatus.open,
        title: 'Open task',
        dueDate: '2026-07-31',
        preferredAgent: 'codex',
      ),
      _task(
        'progress-task',
        TaskStatus.inProgress,
        title: 'Progress task',
      ),
      _task(
        'waiting-task',
        TaskStatus.waitingForReply,
        title: 'Waiting task',
      ),
      _task('done-task', TaskStatus.done, title: 'Done task'),
    ];

Task _task(
  String id,
  TaskStatus status, {
  required String title,
  int? scheduledOrder,
  String? dueDate,
  String? preferredAgent,
}) =>
    Task(
      id: id,
      title: title,
      status: status,
      scheduledOrder: scheduledOrder,
      dueDate: dueDate,
      preferredAgent: preferredAgent,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    );

class _FakeTasksDataSource extends TasksLocalDataSource {
  _FakeTasksDataSource({
    required this.tasks,
    this.loadCompleter,
    this.loadError,
  }) : super(baseUrl: 'http://example.invalid');

  final List<Task> tasks;
  final Completer<List<Task>>? loadCompleter;
  final Object? loadError;

  int updateCalls = 0;
  String? updatedTaskId;
  String? updatedStatus;

  @override
  Future<List<Task>> fetchAll() async {
    if (loadError != null) throw loadError!;
    if (loadCompleter != null) return loadCompleter!.future;
    return tasks;
  }

  @override
  Future<Task> update(
    String id, {
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    String? status,
    int? ownerId,
    bool includeNotes = false,
    bool includeDueDate = false,
    bool includeScheduledDate = false,
    bool includeOwnerId = false,
    bool includePreferredAgent = false,
    String? preferredAgent,
    bool includeGoalId = false,
    String? goalId,
    bool includePriority = false,
    int? priority,
    bool includeTags = false,
    List<String>? tags,
    bool includeEnergy = false,
    String? energy,
  }) async {
    updateCalls += 1;
    updatedTaskId = id;
    updatedStatus = status;
    final task = tasks.firstWhere((task) => task.id == id);
    return task.copyWith(
      status: TaskStatusJson.fromJson(status ?? task.status.toJson()),
    );
  }
}

class _NoopWorkspaceController extends WorkspaceController {
  _NoopWorkspaceController(super.repository);

  @override
  Future<void> loadMembers() async {}
}
