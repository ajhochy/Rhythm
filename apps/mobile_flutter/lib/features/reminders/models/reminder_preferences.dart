import 'package:flutter/material.dart';

/// User-configurable preferences that control when task-reminder notifications
/// are scheduled.
class ReminderPreferences {
  const ReminderPreferences({
    this.enabled = true,
    this.reminderTime = const TimeOfDay(hour: 9, minute: 0),
    this.quietHoursStart = const TimeOfDay(hour: 22, minute: 0),
    this.quietHoursEnd = const TimeOfDay(hour: 7, minute: 0),
  });

  /// Kill switch — when false, no notifications are scheduled.
  final bool enabled;

  /// The time of day at which today's task reminders fire.
  final TimeOfDay reminderTime;

  /// Start of the quiet-hours window (notifications are suppressed).
  final TimeOfDay quietHoursStart;

  /// End of the quiet-hours window (notifications resume).
  final TimeOfDay quietHoursEnd;

  // ---------------------------------------------------------------------------
  // Serialisation helpers
  // ---------------------------------------------------------------------------

  static TimeOfDay _timeFromString(String value) {
    final parts = value.split(':');
    return TimeOfDay(
      hour: int.parse(parts[0]),
      minute: int.parse(parts[1]),
    );
  }

  static String _timeToString(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  factory ReminderPreferences.fromJson(Map<String, dynamic> json) {
    return ReminderPreferences(
      enabled: (json['enabled'] as bool?) ?? true,
      reminderTime: json['reminderTime'] != null
          ? _timeFromString(json['reminderTime'] as String)
          : const TimeOfDay(hour: 9, minute: 0),
      quietHoursStart: json['quietHoursStart'] != null
          ? _timeFromString(json['quietHoursStart'] as String)
          : const TimeOfDay(hour: 22, minute: 0),
      quietHoursEnd: json['quietHoursEnd'] != null
          ? _timeFromString(json['quietHoursEnd'] as String)
          : const TimeOfDay(hour: 7, minute: 0),
    );
  }

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'reminderTime': _timeToString(reminderTime),
        'quietHoursStart': _timeToString(quietHoursStart),
        'quietHoursEnd': _timeToString(quietHoursEnd),
      };

  ReminderPreferences copyWith({
    bool? enabled,
    TimeOfDay? reminderTime,
    TimeOfDay? quietHoursStart,
    TimeOfDay? quietHoursEnd,
  }) {
    return ReminderPreferences(
      enabled: enabled ?? this.enabled,
      reminderTime: reminderTime ?? this.reminderTime,
      quietHoursStart: quietHoursStart ?? this.quietHoursStart,
      quietHoursEnd: quietHoursEnd ?? this.quietHoursEnd,
    );
  }
}
