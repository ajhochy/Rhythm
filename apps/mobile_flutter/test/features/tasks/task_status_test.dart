import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_mobile/features/tasks/models/task.dart';

void main() {
  test('issue-1475: deferred survives mobile JSON decode and encode', () {
    final task = Task.fromJson({
      'id': 'deferred-task',
      'title': 'Deferred task',
      'status': 'deferred',
      'createdAt': '2026-08-27T00:00:00.000Z',
      'updatedAt': '2026-08-27T00:00:00.000Z',
    });

    expect(task.status, TaskStatus.deferred);
    expect(task.status.toJson(), 'deferred');
  });
}
