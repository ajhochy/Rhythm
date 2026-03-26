import '../models/recurring_task_rule.dart';

/// Client-side preview service that mirrors the backend recurrence logic.
/// Used exclusively for UI previews — no persistence side effects.
class RecurrenceService {
  /// Returns the next [count] occurrence dates for [rule] starting from [from].
  List<DateTime> previewNextDates(RecurringTaskRule rule, DateTime from,
      {int count = 5}) {
    final results = <DateTime>[];
    DateTime cursor = DateTime.utc(from.year, from.month, from.day);

    while (results.length < count) {
      final candidates = _computeYear(rule, cursor.year);
      for (final date in candidates) {
        if (!date.isBefore(cursor) && results.length < count) {
          results.add(date);
        }
      }
      cursor = DateTime.utc(cursor.year + 1, 1, 1);
      if (cursor.year > from.year + 10) break; // safety ceiling
    }
    return results;
  }

  /// Returns all dates for [rule] within [from]..[to] (inclusive).
  List<DateTime> generateDates(
      RecurringTaskRule rule, DateTime from, DateTime to) {
    final results = <DateTime>[];
    for (int year = from.year; year <= to.year; year++) {
      for (final date in _computeYear(rule, year)) {
        if (!date.isBefore(from) && !date.isAfter(to)) {
          results.add(date);
        }
      }
    }
    return results;
  }

  List<DateTime> _computeYear(RecurringTaskRule rule, int year) {
    switch (rule.frequency) {
      case 'weekly':
        return _weeklyDatesForYear(rule, year);
      case 'monthly':
        return _monthlyDatesForYear(rule, year);
      case 'annual':
        return _annualDatesForYear(rule, year);
      default:
        return [];
    }
  }

  List<DateTime> _weeklyDatesForYear(RecurringTaskRule rule, int year) {
    final targetDow = rule.dayOfWeek ?? 1; // Monday
    final results = <DateTime>[];
    var cur = DateTime.utc(year, 1, 1);
    final daysUntilTarget = (targetDow - cur.weekday % 7 + 7) % 7;
    cur = cur.add(Duration(days: daysUntilTarget));
    while (cur.year == year) {
      results.add(cur);
      cur = cur.add(const Duration(days: 7));
    }
    return results;
  }

  List<DateTime> _monthlyDatesForYear(RecurringTaskRule rule, int year) {
    final dom = rule.dayOfMonth ?? 1;
    return List.generate(12, (i) => _resolveMonthDay(year, i + 1, dom));
  }

  List<DateTime> _annualDatesForYear(RecurringTaskRule rule, int year) {
    final m = rule.month ?? 1;
    final d = rule.dayOfMonth ?? 1;
    return [_resolveMonthDay(year, m, d)];
  }

  DateTime _resolveMonthDay(int year, int month, int day) {
    final lastDay = DateTime.utc(year, month + 1, 0).day;
    return DateTime.utc(year, month, day.clamp(1, lastDay));
  }
}
