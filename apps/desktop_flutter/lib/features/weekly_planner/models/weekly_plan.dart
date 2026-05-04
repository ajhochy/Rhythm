import '../../tasks/models/task.dart';

class WeeklyPlanDay {
  WeeklyPlanDay({required this.date, required this.tasks});

  factory WeeklyPlanDay.fromJson(Map<String, dynamic> json) {
    return WeeklyPlanDay(
      date: json['date'] as String,
      tasks: (json['tasks'] as List<dynamic>)
          .map((t) => Task.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }

  final String date;
  final List<Task> tasks;
}

class WeeklyPlan {
  WeeklyPlan({
    required this.weekLabel,
    required this.weekStart,
    required this.days,
    required this.backlog,
  });

  factory WeeklyPlan.fromJson(Map<String, dynamic> json) {
    return WeeklyPlan(
      weekLabel: json['weekLabel'] as String,
      weekStart: json['weekStart'] as String,
      days: (json['days'] as List<dynamic>)
          .map((d) => WeeklyPlanDay.fromJson(d as Map<String, dynamic>))
          .toList(),
      backlog: ((json['backlog'] as List<dynamic>?) ?? [])
          .map((t) => Task.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }

  final String weekLabel;
  final String weekStart;
  final List<WeeklyPlanDay> days;

  /// Tasks with no due date and no scheduled date — from API backlog field.
  final List<Task> backlog;

  /// Tasks to display in a day column.
  /// scheduledDate takes priority; falls back to dueDate.
  /// Multi-day calendar events also appear in every day column they span.
  List<Task> tasksForDate(String date) {
    return days.expand((d) => d.tasks).where((t) {
      final primaryDate = t.scheduledDate ?? t.dueDate;
      if (primaryDate == date) return true;

      if (t.sourceType == 'calendar_shadow_event' &&
          t.startsAt != null &&
          t.endsAt != null) {
        final startDate = t.startsAt!.substring(0, 10);
        final endDate = t.endsAt!.substring(0, 10);
        final afterStart = date.compareTo(startDate) > 0;
        // All-day events use an exclusive end (Google Calendar convention).
        final beforeEnd = t.isAllDay
            ? date.compareTo(endDate) < 0
            : date.compareTo(endDate) <= 0;
        if (afterStart && beforeEnd) return true;
      }

      return false;
    }).toList();
  }
}
