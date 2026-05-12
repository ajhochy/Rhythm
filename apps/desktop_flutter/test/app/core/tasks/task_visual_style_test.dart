import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/tasks/task_visual_style.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Task _makeTask({
  TaskStatus status = TaskStatus.open,
  String? dueDate,
  String? scheduledDate,
  String? sourceType,
}) {
  return Task(
    id: 'test-id',
    title: 'Test task',
    status: status,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    dueDate: dueDate,
    scheduledDate: scheduledDate,
    sourceType: sourceType,
  );
}

void main() {
  // Fixed reference date: 2025-06-15
  final today = DateTime(2025, 6, 15);
  const yesterday = '2025-06-14';
  const todayStr = '2025-06-15';
  const tomorrow = '2025-06-16';
  const nextWeek = '2025-06-22';

  // ---------------------------------------------------------------------------
  // Branch 1: done
  // ---------------------------------------------------------------------------
  group('resolve — done state', () {
    test('done task resolves to done style regardless of dates', () {
      final task = _makeTask(
        status: TaskStatus.done,
        dueDate: yesterday,
        scheduledDate: yesterday,
      );
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.done);
      expect(style.accent, const Color(0xFF94A3B8));
      expect(style.label, isNull);
    });
  });

  // ---------------------------------------------------------------------------
  // Branch 2: overdue (red)
  // ---------------------------------------------------------------------------
  group('resolve — overdue state', () {
    test('past scheduledDate → overdue (red)', () {
      final task = _makeTask(
        dueDate: nextWeek,
        scheduledDate: yesterday,
      );
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.overdue);
      expect(style.accent, const Color(0xFFDC5B58));
      expect(style.label, isNull);
    });

    test('past dueDate with no scheduledDate → overdue (red)', () {
      final task = _makeTask(dueDate: yesterday);
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.overdue);
      expect(style.accent, const Color(0xFFDC5B58));
    });
  });

  // ---------------------------------------------------------------------------
  // Branch 3: pastDeadline (amber) — dueDate in past, scheduledDate in future
  // ---------------------------------------------------------------------------
  group('resolve — pastDeadline state', () {
    test(
        'dueDate past + scheduledDate future → pastDeadline (amber), '
        'NOT overdue', () {
      final task = _makeTask(
        dueDate: yesterday,
        scheduledDate: tomorrow,
      );
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.pastDeadline);
      expect(style.accent, const Color(0xFFF59E0B));
      expect(style.background, const Color(0xFFFEF3C7));
      expect(style.label, 'Past deadline');
    });

    test('dueDate today, scheduledDate future → NOT pastDeadline', () {
      final task = _makeTask(
        dueDate: todayStr,
        scheduledDate: tomorrow,
      );
      final style = TaskVisualStyles.resolve(task, today: today);
      // dueDate is not before today, so no pastDeadline
      expect(style.state, isNot(TaskVisualState.pastDeadline));
    });

    test('dueDate past, scheduledDate today → overdue wins over pastDeadline',
        () {
      // scheduledDate today means isOverdue is false (not strictly before),
      // but dueDate is past → only isPastDeadline is true, and isOverdue=false
      // So this is pastDeadline, not overdue.
      final task = _makeTask(
        dueDate: yesterday,
        scheduledDate: todayStr,
      );
      final style = TaskVisualStyles.resolve(task, today: today);
      // scheduledDate is today (not overdue), dueDate is past (pastDeadline)
      expect(style.state, TaskVisualState.pastDeadline);
    });
  });

  // ---------------------------------------------------------------------------
  // Precedence: overdue wins over pastDeadline
  // ---------------------------------------------------------------------------
  group('resolve — precedence: overdue beats pastDeadline', () {
    test(
        'scheduledDate in past AND dueDate in past → overdue wins (red, not amber)',
        () {
      // Both isOverdue and isPastDeadline are true.
      // Overdue must win (red).
      final task = _makeTask(
        dueDate: yesterday,
        scheduledDate: yesterday,
      );
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.overdue);
      expect(style.accent, const Color(0xFFDC5B58),
          reason: 'Red overdue color must win over amber pastDeadline');
      expect(style.label, isNull);
    });
  });

  // ---------------------------------------------------------------------------
  // Branch 4: dueToday
  // ---------------------------------------------------------------------------
  group('resolve — dueToday state', () {
    test('scheduledDate today → dueToday (orange)', () {
      final task = _makeTask(scheduledDate: todayStr);
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.dueToday);
      expect(style.accent, const Color(0xFFE29A3A));
      expect(style.label, isNull);
    });

    test('dueDate today, no scheduledDate → dueToday (orange)', () {
      final task = _makeTask(dueDate: todayStr);
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.dueToday);
      expect(style.accent, const Color(0xFFE29A3A));
    });
  });

  // ---------------------------------------------------------------------------
  // Branch 5: source-based / default
  // ---------------------------------------------------------------------------
  group('resolve — source-based / default', () {
    test('no dates, no source → default style', () {
      final task = _makeTask();
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.sourceBased);
      expect(style.accent, const Color(0xFF64748B));
      expect(style.label, isNull);
    });

    test('future due date → default style (not overdue, not today)', () {
      final task = _makeTask(dueDate: nextWeek);
      final style = TaskVisualStyles.resolve(task, today: today);
      expect(style.state, TaskVisualState.sourceBased);
    });
  });

  // ---------------------------------------------------------------------------
  // No regression on existing colors
  // ---------------------------------------------------------------------------
  group('resolve — no regression on existing colors', () {
    test('overdue accent is still DC5B58', () {
      final task = _makeTask(dueDate: yesterday, scheduledDate: yesterday);
      expect(
        TaskVisualStyles.resolve(task, today: today).accent,
        const Color(0xFFDC5B58),
      );
    });

    test('dueToday accent is still E29A3A', () {
      final task = _makeTask(dueDate: todayStr);
      expect(
        TaskVisualStyles.resolve(task, today: today).accent,
        const Color(0xFFE29A3A),
      );
    });

    test('done accent is still 94A3B8', () {
      final task = _makeTask(status: TaskStatus.done, dueDate: yesterday);
      expect(
        TaskVisualStyles.resolve(task, today: today).accent,
        const Color(0xFF94A3B8),
      );
    });

    test('pastDeadline accent is F59E0B (amber-500)', () {
      final task = _makeTask(dueDate: yesterday, scheduledDate: tomorrow);
      expect(
        TaskVisualStyles.resolve(task, today: today).accent,
        const Color(0xFFF59E0B),
      );
    });

    test('pastDeadline background is FEF3C7 (amber-100)', () {
      final task = _makeTask(dueDate: yesterday, scheduledDate: tomorrow);
      expect(
        TaskVisualStyles.resolve(task, today: today).background,
        const Color(0xFFFEF3C7),
      );
    });
  });
}
