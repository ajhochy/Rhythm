/// #908 — Tasks list sort control.
///
/// Search, "Open/All" (hide completed), and time-range grouping already
/// existed; this covers the added sort comparator (due date / created date /
/// status / title). Pure unit tests of `compareTasksBySortField` -- mounting
/// the full TasksView hits a pre-existing RhythmColorLegend/RhythmToolbar
/// overflow at typical test-harness widths, unrelated to this change, so the
/// comparator is tested directly (it's a top-level function precisely so it
/// can be).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/views/tasks_view.dart';

Task _task(
  String id,
  String title, {
  String? dueDate,
  String? scheduledDate,
  required String createdAt,
  TaskStatus status = TaskStatus.open,
}) => Task(
  id: id,
  title: title,
  status: status,
  dueDate: dueDate,
  scheduledDate: scheduledDate,
  createdAt: createdAt,
  updatedAt: createdAt,
);

void main() {
  group('compareTasksBySortField (#908)', () {
    test('title sorts case-insensitively', () {
      final tasks = [
        _task('t1', 'zebra', createdAt: '2026-01-01'),
        _task('t2', 'Alpha', createdAt: '2026-01-01'),
      ];
      tasks.sort((a, b) => compareTasksBySortField(a, b, TaskSortField.title));
      expect(tasks.map((t) => t.id), ['t2', 't1']);
    });

    test('createdDate sorts oldest first', () {
      final tasks = [
        _task('t1', 'B', createdAt: '2026-01-05'),
        _task('t2', 'A', createdAt: '2026-01-01'),
      ];
      tasks.sort(
        (a, b) => compareTasksBySortField(a, b, TaskSortField.createdDate),
      );
      expect(tasks.map((t) => t.id), ['t2', 't1']);
    });

    test('status sorts open, then in-progress, then waiting, then done', () {
      final tasks = [
        _task('t1', 'A', createdAt: '2026-01-01', status: TaskStatus.done),
        _task('t2', 'B', createdAt: '2026-01-01', status: TaskStatus.open),
        _task(
          't3',
          'C',
          createdAt: '2026-01-01',
          status: TaskStatus.waitingForReply,
        ),
        _task(
          't4',
          'D',
          createdAt: '2026-01-01',
          status: TaskStatus.inProgress,
        ),
      ];
      tasks.sort((a, b) => compareTasksBySortField(a, b, TaskSortField.status));
      expect(tasks.map((t) => t.id), ['t2', 't4', 't3', 't1']);
    });

    test('dueDate sorts earliest first and falls back to scheduledDate', () {
      final tasks = [
        _task('t1', 'A', dueDate: '2026-01-10', createdAt: '2026-01-01'),
        _task('t2', 'B', scheduledDate: '2026-01-05', createdAt: '2026-01-01'),
      ];
      tasks.sort(
        (a, b) => compareTasksBySortField(a, b, TaskSortField.dueDate),
      );
      expect(tasks.map((t) => t.id), ['t2', 't1']);
    });

    test('dueDate sort pushes tasks with no date to the end', () {
      final tasks = [
        _task('t1', 'No date', createdAt: '2026-01-01'),
        _task('t2', 'Has date', dueDate: '2026-01-05', createdAt: '2026-01-01'),
      ];
      tasks.sort(
        (a, b) => compareTasksBySortField(a, b, TaskSortField.dueDate),
      );
      expect(tasks.map((t) => t.id), ['t2', 't1']);
    });
  });
}
