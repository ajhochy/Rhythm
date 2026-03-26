class AutomationRule {
  const AutomationRule({
    required this.id,
    required this.name,
    required this.triggerType,
    this.triggerConfig,
    required this.actionType,
    this.actionConfig,
    required this.enabled,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String triggerType;
  final Map<String, dynamic>? triggerConfig;
  final String actionType;
  final Map<String, dynamic>? actionConfig;
  final bool enabled;
  final String createdAt;
  final String updatedAt;

  factory AutomationRule.fromJson(Map<String, dynamic> json) {
    return AutomationRule(
      id: json['id'] as String,
      name: json['name'] as String,
      triggerType: json['triggerType'] as String,
      triggerConfig: json['triggerConfig'] as Map<String, dynamic>?,
      actionType: json['actionType'] as String,
      actionConfig: json['actionConfig'] as Map<String, dynamic>?,
      enabled: json['enabled'] as bool? ?? true,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'triggerType': triggerType,
        if (triggerConfig != null) 'triggerConfig': triggerConfig,
        'actionType': actionType,
        if (actionConfig != null) 'actionConfig': actionConfig,
        'enabled': enabled,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  static const triggerTypes = [
    'project_step_due',
    'task_due',
    'plan_assembly',
  ];

  static const actionTypes = [
    'auto_schedule',
    'send_notification',
    'tag_task',
  ];

  static String triggerLabel(String type) => switch (type) {
        'project_step_due' => 'Project step is due',
        'task_due' => 'Task is due',
        'plan_assembly' => 'Plan is assembled',
        _ => type,
      };

  static String actionLabel(String type) => switch (type) {
        'auto_schedule' => 'Auto-schedule to day',
        'send_notification' => 'Send notification',
        'tag_task' => 'Tag task',
        _ => type,
      };
}
