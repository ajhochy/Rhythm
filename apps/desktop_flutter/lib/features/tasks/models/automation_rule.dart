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

  factory AutomationRule.fromJson(Map<String, dynamic> json) {
    return AutomationRule(
      id: json['id'] as String,
      name: json['name'] as String,
      source: json['source'] as String? ?? 'rhythm',
      triggerKey: json['triggerKey'] as String,
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
}
