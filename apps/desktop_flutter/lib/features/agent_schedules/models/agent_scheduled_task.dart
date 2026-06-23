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
        return cronExpression ?? 'Custom cron';
      case 'once':
        return runAt != null ? 'Once at $runAt' : 'Once';
      default:
        return scheduleType;
    }
  }
}
