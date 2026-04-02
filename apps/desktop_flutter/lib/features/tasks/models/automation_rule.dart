class AutomationRule {
  const AutomationRule({
    required this.id,
    required this.name,
    required this.source,
    required this.triggerKey,
    this.triggerConfig,
    required this.actionType,
    this.actionConfig,
    required this.enabled,
    this.sourceAccountId,
    this.lastEvaluatedAt,
    this.lastMatchedAt,
    this.matchCountLastRun = 0,
    this.previewSample,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String source;
  final String triggerKey;
  final Map<String, dynamic>? triggerConfig;
  final String actionType;
  final Map<String, dynamic>? actionConfig;
  final bool enabled;
  final String? sourceAccountId;
  final String? lastEvaluatedAt;
  final String? lastMatchedAt;
  final int matchCountLastRun;
  final Map<String, dynamic>? previewSample;
  final String createdAt;
  final String updatedAt;

  String get triggerType => switch (triggerKey) {
        'rhythm.project_step_due' => 'project_step_due',
        'rhythm.task_due' => 'task_due',
        'rhythm.plan_assembly' => 'plan_assembly',
        _ => triggerKey,
      };

  factory AutomationRule.fromJson(Map<String, dynamic> json) {
    return AutomationRule(
      id: json['id'] as String,
      name: json['name'] as String,
      source: json['source'] as String? ?? 'rhythm',
      triggerKey: (json['triggerKey'] as String?) ??
          _legacyTriggerKey(json['triggerType'] as String?),
      triggerConfig: json['triggerConfig'] as Map<String, dynamic>?,
      actionType: json['actionType'] as String,
      actionConfig: json['actionConfig'] as Map<String, dynamic>?,
      enabled: json['enabled'] as bool? ?? true,
      sourceAccountId: json['sourceAccountId'] as String?,
      lastEvaluatedAt: json['lastEvaluatedAt'] as String?,
      lastMatchedAt: json['lastMatchedAt'] as String?,
      matchCountLastRun: (json['matchCountLastRun'] as num?)?.toInt() ?? 0,
      previewSample: json['previewSample'] as Map<String, dynamic>?,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'source': source,
        'triggerKey': triggerKey,
        if (triggerConfig != null) 'triggerConfig': triggerConfig,
        'actionType': actionType,
        if (actionConfig != null) 'actionConfig': actionConfig,
        'enabled': enabled,
        if (sourceAccountId != null) 'sourceAccountId': sourceAccountId,
        if (lastEvaluatedAt != null) 'lastEvaluatedAt': lastEvaluatedAt,
        if (lastMatchedAt != null) 'lastMatchedAt': lastMatchedAt,
        'matchCountLastRun': matchCountLastRun,
        if (previewSample != null) 'previewSample': previewSample,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  static String _legacyTriggerKey(String? triggerType) => switch (triggerType) {
        'project_step_due' => 'rhythm.project_step_due',
        'task_due' => 'rhythm.task_due',
        'plan_assembly' => 'rhythm.plan_assembly',
        _ => triggerType ?? 'rhythm.task_due',
      };

  static String triggerLabel(String type) => switch (type) {
        'project_step_due' => 'Project step is due',
        'rhythm.project_step_due' => 'Project step is due',
        'task_due' => 'Task is due',
        'rhythm.task_due' => 'Task is due',
        'plan_assembly' => 'Plan is assembled',
        'rhythm.plan_assembly' => 'Plan is assembled',
        'planning_center.plan_person_declined' => 'Volunteer declined',
        'planning_center.plan_person_unconfirmed' => 'Volunteer unconfirmed',
        'planning_center.needed_position_open' => 'Needed position open',
        'planning_center.special_service_candidate' =>
          'Special service candidate',
        'google_calendar.event_matching_filter' =>
          'Calendar event matches filter',
        'google_calendar.all_day_event' => 'All-day calendar event',
        'gmail.message_matching_filter' => 'Gmail message matches filter',
        'gmail.unread_message_matching_filter' =>
          'Unread Gmail message matches filter',
        _ => type,
      };

  static String actionLabel(String type) => switch (type) {
        'create_task' => 'Create task',
        'create_project_from_template' => 'Create project from template',
        'auto_schedule' => 'Auto-schedule to day',
        'send_notification' => 'Send notification',
        'tag_task' => 'Tag task',
        _ => type,
      };
}
