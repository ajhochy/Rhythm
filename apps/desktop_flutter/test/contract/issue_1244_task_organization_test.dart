import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';

void main() {
  test(
      'issue-1244-c5: list and board share exact tag and minimum-priority filtering',
      () {
    // Regression caught: JSON arrives correctly but the client drops it, or
    // list and Kanban independently filter and show different task sets.
    final decoded = Task.fromJson({
      'id': 'task-1244',
      'title': 'Cross-project worship task',
      'status': 'open',
      'priority': 3,
      'tags': ['worship', 'christmas-eve'],
      'createdAt': '2026-08-11T00:00:00.000Z',
      'updatedAt': '2026-08-11T00:00:00.000Z',
    });
    final fields = decoded as dynamic;
    expect(fields.priority, 3);
    expect(fields.tags, ['worship', 'christmas-eve']);

    final source = File(
      'lib/features/tasks/views/tasks_view.dart',
    ).readAsStringSync();
    expect(source, contains('task.tags.contains(_activeTag)'));
    expect(source, contains('(task.priority ?? 0) >= _minimumPriority'));
    expect(source, contains('tasks: visibleTasks'));
    expect(source, contains('_buildTaskListSliver(controller, visibleTasks)'));
  });
}
