// ignore_for_file: deprecated_member_use

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/formatters/date_formatters.dart';

void main() {
  // Convenience: a fixed "today" so tests are deterministic.
  final today = DateTime(2025, 6, 15);
  final yesterday = '2025-06-14';
  final todayStr = '2025-06-15';
  final tomorrow = '2025-06-16';

  // ---------------------------------------------------------------------------
  // isOverdue
  // ---------------------------------------------------------------------------
  group('DateFormatters.isOverdue', () {
    test('scheduled-only: past scheduled → overdue', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: yesterday,
          isDone: false,
          today: today,
        ),
        isTrue,
      );
    });

    test('scheduled-only: future scheduled → not overdue', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: tomorrow,
          isDone: false,
          today: today,
        ),
        isFalse,
      );
    });

    test('due-only: past due → overdue', () {
      expect(
        DateFormatters.isOverdue(
          dueDate: yesterday,
          isDone: false,
          today: today,
        ),
        isTrue,
      );
    });

    test('due-only: future due → not overdue', () {
      expect(
        DateFormatters.isOverdue(
          dueDate: tomorrow,
          isDone: false,
          today: today,
        ),
        isFalse,
      );
    });

    test(
        'both set: scheduled takes priority — future scheduled + past due → not overdue (bug repro)',
        () {
      // A task whose dueDate is past but scheduledDate is in the future should
      // NOT be considered overdue; the user scheduled it for a later date.
      expect(
        DateFormatters.isOverdue(
          scheduledDate: tomorrow,
          dueDate: yesterday,
          isDone: false,
          today: today,
        ),
        isFalse,
      );
    });

    test('both set: past scheduled + future due → overdue', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: yesterday,
          dueDate: tomorrow,
          isDone: false,
          today: today,
        ),
        isTrue,
      );
    });

    test('both null → not overdue', () {
      expect(
        DateFormatters.isOverdue(isDone: false, today: today),
        isFalse,
      );
    });

    test('done status → never overdue even with past date', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: yesterday,
          dueDate: yesterday,
          isDone: true,
          today: today,
        ),
        isFalse,
      );
    });

    test('today edge: date == today → not overdue (strict <)', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: todayStr,
          isDone: false,
          today: today,
        ),
        isFalse,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // isPastDeadline
  // ---------------------------------------------------------------------------
  group('DateFormatters.isPastDeadline', () {
    test('past dueDate → past deadline', () {
      expect(
        DateFormatters.isPastDeadline(
          dueDate: yesterday,
          isDone: false,
          today: today,
        ),
        isTrue,
      );
    });

    test('future dueDate → not past deadline', () {
      expect(
        DateFormatters.isPastDeadline(
          dueDate: tomorrow,
          isDone: false,
          today: today,
        ),
        isFalse,
      );
    });

    test('dueDate null → not past deadline', () {
      expect(
        DateFormatters.isPastDeadline(isDone: false, today: today),
        isFalse,
      );
    });

    test('done status → never past deadline even with past dueDate', () {
      expect(
        DateFormatters.isPastDeadline(
          dueDate: yesterday,
          isDone: true,
          today: today,
        ),
        isFalse,
      );
    });

    test('today edge: dueDate == today → not past deadline (strict <)', () {
      expect(
        DateFormatters.isPastDeadline(
          dueDate: todayStr,
          isDone: false,
          today: today,
        ),
        isFalse,
      );
    });

    test(
        'scheduledDate is ignored — future scheduled + past due → past deadline',
        () {
      // isPastDeadline only cares about dueDate, never scheduledDate.
      expect(
        DateFormatters.isPastDeadline(
          dueDate: yesterday,
          isDone: false,
          today: today,
        ),
        isTrue,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // priorityDate
  // ---------------------------------------------------------------------------
  group('DateFormatters.priorityDate', () {
    test('returns scheduledDate when both set', () {
      final result = DateFormatters.priorityDate(
        scheduledDate: '2025-07-01',
        dueDate: '2025-08-01',
      );
      expect(result, equals(DateTime(2025, 7, 1)));
    });

    test('returns dueDate when scheduledDate absent', () {
      final result = DateFormatters.priorityDate(dueDate: '2025-08-01');
      expect(result, equals(DateTime(2025, 8, 1)));
    });

    test('returns scheduledDate when dueDate absent', () {
      final result = DateFormatters.priorityDate(scheduledDate: '2025-07-01');
      expect(result, equals(DateTime(2025, 7, 1)));
    });

    test('returns null when both absent', () {
      expect(DateFormatters.priorityDate(), isNull);
    });
  });

  // ---------------------------------------------------------------------------
  // isPastDue — deprecated alias
  // ---------------------------------------------------------------------------
  group('DateFormatters.isPastDue (deprecated alias)', () {
    test('delegates to isOverdue: past scheduled → true', () {
      expect(
        DateFormatters.isPastDue(
          dueDate: null,
          scheduledDate: yesterday,
          isDone: false,
          today: today,
        ),
        isTrue,
      );
    });

    test('delegates to isOverdue: done → false', () {
      expect(
        DateFormatters.isPastDue(
          dueDate: yesterday,
          scheduledDate: null,
          isDone: true,
          today: today,
        ),
        isFalse,
      );
    });
  });
}
