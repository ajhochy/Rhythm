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
  // Canonical cross-stack date-status predicate matrix
  //
  // Anchor date: 2026-05-11 (today).
  // Every row mirrors the identical matrix in
  // apps/api_server/src/__tests__/task_date_status.test.ts so both stacks
  // can be verified to agree bit-for-bit.
  // ---------------------------------------------------------------------------
  group('cross-stack matrix (anchor: 2026-05-11)', () {
    final matrixToday = DateTime(2026, 5, 11);

    test('case 1: done task, both dates in past → neither flag set', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-04-01',
          dueDate: '2026-04-01',
          isDone: true,
          today: matrixToday,
        ),
        isFalse,
      );
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-04-01',
          isDone: true,
          today: matrixToday,
        ),
        isFalse,
      );
    });

    test('case 2: open, no dates → neither flag set', () {
      expect(
        DateFormatters.isOverdue(isDone: false, today: matrixToday),
        isFalse,
      );
      expect(
        DateFormatters.isPastDeadline(isDone: false, today: matrixToday),
        isFalse,
      );
    });

    test('case 3: open, future scheduled, no due → neither flag set', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-05-15',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
      // isPastDeadline ignores scheduledDate — no dueDate means not past deadline
      expect(
        DateFormatters.isPastDeadline(
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
    });

    test('case 4: open, past scheduled, no due → overdue only', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-05-05',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
      // isPastDeadline ignores scheduledDate — no dueDate means not past deadline
      expect(
        DateFormatters.isPastDeadline(
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
    });

    test('case 5: open, no scheduled, future due → neither flag set', () {
      expect(
        DateFormatters.isOverdue(
          dueDate: '2026-05-15',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-05-15',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
    });

    test('case 6: open, no scheduled, past due → both flags set', () {
      expect(
        DateFormatters.isOverdue(
          dueDate: '2026-05-05',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-05-05',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
    });

    test(
        'case 7: scheduled future, deadline past → past-deadline only — the original reported bug',
        () {
      // scheduledDate wins for isOverdue (future → not overdue).
      // isPastDeadline only checks dueDate (past → true).
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-05-15',
          dueDate: '2026-05-05',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
      // isPastDeadline ignores scheduledDate — only dueDate matters (past → true)
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-05-05',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
    });

    test('case 8: open, past scheduled, future due → overdue only', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-05-05',
          dueDate: '2026-05-15',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
      // isPastDeadline ignores scheduledDate — future dueDate means not past deadline
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-05-15',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
    });

    test(
        'case 9: open, both dates == today → neither flag set (today is not past)',
        () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-05-11',
          dueDate: '2026-05-11',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
      // isPastDeadline ignores scheduledDate — dueDate == today is not past
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-05-11',
          isDone: false,
          today: matrixToday,
        ),
        isFalse,
      );
    });

    test('case 10: open, both dates == yesterday → both flags set', () {
      expect(
        DateFormatters.isOverdue(
          scheduledDate: '2026-05-10',
          dueDate: '2026-05-10',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
      // isPastDeadline ignores scheduledDate — dueDate in past → true
      expect(
        DateFormatters.isPastDeadline(
          dueDate: '2026-05-10',
          isDone: false,
          today: matrixToday,
        ),
        isTrue,
      );
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
