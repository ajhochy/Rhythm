import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

void main() {
  test('issue-1245-c1: rhythm card donut consumes completionRatio', () {
    // Regression caught: the API/model still carries 0.75 but the rhythm card
    // renders only its repeat icon and title, so users see no progress loop.
    final source = File(
      'lib/features/rhythms/views/rhythms_view.dart',
    ).readAsStringSync();
    expect(source, contains('CircularStepProgressIndicator'));
    expect(source, contains('rule.completionFraction'));
    expect(source, contains("ValueKey('rhythm-progress-donut-\${rule.id}')"));
  });

  test(
    'issue-1245-c2: affirmation emits once only after a successful transition to done',
    () async {
      // Regression caught: optimistic UI celebrates a failed request, celebrates
      // done→open, or repeats the same celebration on every rebuild.
      final dataSource = _CompletionDataSource();
      final controller = TasksController(TasksRepository(dataSource));
      await controller.load();

      await controller.toggleDone('task-1');
      final dynamic dynamicController = controller;
      expect(dynamicController.takeCompletionAffirmation(), isNotNull);
      expect(dynamicController.takeCompletionAffirmation(), isNull);

      await controller.toggleDone('task-1');
      expect(dynamicController.takeCompletionAffirmation(), isNull);

      dataSource.failUpdates = true;
      await controller.toggleDone('task-1');
      expect(dynamicController.takeCompletionAffirmation(), isNull);
    },
  );
}

class _CompletionDataSource extends TasksLocalDataSource {
  _CompletionDataSource() : super(baseUrl: 'http://example.invalid');

  Task task = Task(
    id: 'task-1',
    title: 'Finish the service plan',
    status: TaskStatus.open,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  );
  bool failUpdates = false;

  @override
  Future<List<Task>> fetchAll() async => [task];

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
    if (failUpdates) throw StateError('server rejected transition');
    task = task.copyWith(
      status: TaskStatusJson.fromJson(status ?? task.status.toJson()),
    );
    return task;
  }
}
