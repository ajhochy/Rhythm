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
  });

  factory WeeklyPlan.fromJson(Map<String, dynamic> json) {
    return WeeklyPlan(
      weekLabel: json['weekLabel'] as String,
      weekStart: json['weekStart'] as String,
      days: (json['days'] as List<dynamic>)
          .map((d) => WeeklyPlanDay.fromJson(d as Map<String, dynamic>))
          .toList(),
    );
  }

  final String weekLabel;
  final String weekStart;
  final List<WeeklyPlanDay> days;

  /// Tasks that have not yet been scheduled to a specific day.
  List<Task> get backlog => days
      .expand((d) => d.tasks)
      .where((t) => t.scheduledDate == null)
      .toList();

  /// Tasks scheduled for a given date.
  List<Task> tasksForDate(String date) => days
      .expand((d) => d.tasks)
      .where((t) => t.scheduledDate == date)
      .toList();
}
