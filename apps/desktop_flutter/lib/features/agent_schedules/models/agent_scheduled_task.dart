import 'dart:convert';
import '../../../app/core/utils/json_parsing.dart';

class AgentScheduledTask {
  AgentScheduledTask({
    required this.id,
    required this.name,
    this.description,
    required this.scheduleType,
    this.scheduledTime,
    this.scheduledDay,
    this.cronExpression,
    this.runAt,
    required this.timezone,
    this.nextRunAt,
    required this.prompt,
    required this.agentKind,
    this.agentConfigId,
    this.allowedMcps,
    this.allowedSkills,
    required this.enabled,
    this.lastRunAt,
    this.lastRunStatus,
    this.lastError,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AgentScheduledTask.fromJson(Map<String, dynamic> json) {
    return AgentScheduledTask(
      id: asString(json['id']) ?? '',
      name: asString(json['name']) ?? '',
      description: asString(json['description']),
      scheduleType: asString(json['scheduleType']) ?? 'daily',
      scheduledTime: asString(json['scheduledTime']),
      scheduledDay: asInt(json['scheduledDay']),
      cronExpression: asString(json['cronExpression']),
      runAt: asString(json['runAt']),
      timezone: asString(json['timezone']) ?? 'America/Los_Angeles',
      nextRunAt: asString(json['nextRunAt']),
      prompt: asString(json['prompt']) ?? '',
      agentKind: asString(json['agentKind']) ?? 'opencode',
      agentConfigId:
          asString(json['agentConfigId']) ?? asString(json['agentKind']),
      allowedMcps: _parseStringList(json['allowedMcpsJson']),
      allowedSkills: _parseStringList(json['allowedSkillsJson']),
      enabled: asBool(json['enabled']) ?? true,
      lastRunAt: asString(json['lastRunAt']),
      lastRunStatus: asString(json['lastRunStatus']),
      lastError: asString(json['lastError']),
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
    );
  }

  static List<String>? _parseStringList(dynamic value) {
    if (value == null) return null;
    if (value is List) return value.map((e) => e.toString()).toList();
    if (value is String && value.isNotEmpty) {
      try {
        final decoded = jsonDecode(value);
        if (decoded is List) return decoded.map((e) => e.toString()).toList();
      } catch (_) {}
    }
    return null;
  }

  final String id;
  final String name;
  final String? description;
  final String scheduleType;
  final String? scheduledTime;
  final int? scheduledDay;
  final String? cronExpression;
  final String? runAt;
  final String timezone;
  final String? nextRunAt;
  final String prompt;
  final String agentKind;
  final String? agentConfigId;
  final List<String>? allowedMcps;
  final List<String>? allowedSkills;
  final bool enabled;
  final String? lastRunAt;
  final String? lastRunStatus;
  final String? lastError;
  final String createdAt;
  final String updatedAt;

  /// Human-readable schedule summary.
  String get scheduleLabel {
    switch (scheduleType) {
      case 'daily':
        return scheduledTime != null ? 'Daily at $scheduledTime' : 'Daily';
      case 'weekly':
        final days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        final day =
            (scheduledDay != null && scheduledDay! >= 0 && scheduledDay! <= 6)
                ? days[scheduledDay!]
                : 'Weekly';
        return 'Weekly on $day${scheduledTime != null ? ' at $scheduledTime' : ''}';
      case 'monthly':
        return 'Monthly on day ${scheduledDay ?? '?'}${scheduledTime != null ? ' at $scheduledTime' : ''}';
      case 'cron':
        return cronExpression != null
            ? humanizeCronExpression(cronExpression!)
            : 'Custom cron';
      case 'once':
        return runAt != null ? 'Once at $runAt' : 'Once';
      default:
        return scheduleType;
    }
  }
}

const _cronWeekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

/// Formats hour/minute as "9am" / "9:30am" / "12pm" (no leading zero, minutes
/// omitted when :00) — matches the style used elsewhere in the schedule UI.
String _formatCronTime(int hour, int minute) {
  final period = hour < 12 ? 'am' : 'pm';
  final displayHour = hour % 12 == 0 ? 12 : hour % 12;
  final minutePart = minute == 0 ? '' : ':${minute.toString().padLeft(2, '0')}';
  return '$displayHour$minutePart$period';
}

/// #902 — turns a standard 5-field cron expression (min hour day-of-month
/// month day-of-week) into a short, human-readable description for the
/// common patterns this app's schedule form actually produces. Anything it
/// doesn't recognize (lists, ranges, step values other than day-of-month,
/// multiple weekdays, etc.) falls back to the raw expression rather than
/// guessing — a wrong-but-confident description is worse than the honest cron
/// string.
String humanizeCronExpression(String expr) {
  final parts = expr.trim().split(RegExp(r'\s+'));
  if (parts.length != 5) return expr;
  final [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

  final minute = int.tryParse(minuteStr);
  final hour = int.tryParse(hourStr);
  if (minute == null || hour == null || monthStr != '*') return expr;

  final time = _formatCronTime(hour, minute);

  // Daily: day-of-month and day-of-week both wildcard.
  if (dayStr == '*' && weekdayStr == '*') {
    return 'Daily at $time';
  }

  // Weekly on a single weekday: day-of-month wildcard, weekday a plain number.
  if (dayStr == '*') {
    final weekday = int.tryParse(weekdayStr);
    if (weekday != null && weekday >= 0 && weekday <= 6) {
      return 'Every ${_cronWeekdays[weekday]} at $time';
    }
    return expr;
  }

  // Weekday wildcard from here on — day-of-month drives the description.
  if (weekdayStr != '*') return expr;

  // Interval: */N days.
  final stepMatch = RegExp(r'^\*/(\d+)$').firstMatch(dayStr);
  if (stepMatch != null) {
    final n = int.parse(stepMatch.group(1)!);
    return 'Every $n day${n == 1 ? '' : 's'} at $time';
  }

  // Fixed day-of-month.
  final day = int.tryParse(dayStr);
  if (day != null && day >= 1 && day <= 31) {
    return 'Monthly on day $day at $time';
  }

  return expr;
}
