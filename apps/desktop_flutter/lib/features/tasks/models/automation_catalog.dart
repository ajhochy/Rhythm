class AutomationTriggerCatalogItem {
  const AutomationTriggerCatalogItem({
    required this.key,
    required this.source,
    required this.label,
    required this.description,
    required this.signalTypes,
    required this.configSchema,
  });

  factory AutomationTriggerCatalogItem.fromJson(Map<String, dynamic> json) {
    return AutomationTriggerCatalogItem(
      key: json['key'] as String,
      source: json['source'] as String,
      label: json['label'] as String,
      description: json['description'] as String? ?? '',
      signalTypes: (json['signalTypes'] as List<dynamic>? ?? const [])
          .map((item) => item.toString())
          .toList(),
      configSchema: json['configSchema'] as Map<String, dynamic>? ?? const {},
    );
  }

  final String key;
  final String source;
  final String label;
  final String description;
  final List<String> signalTypes;
  final Map<String, dynamic> configSchema;
}

class AutomationActionCatalogItem {
  const AutomationActionCatalogItem({
    required this.key,
    required this.label,
    required this.description,
    required this.configSchema,
  });

  factory AutomationActionCatalogItem.fromJson(Map<String, dynamic> json) {
    return AutomationActionCatalogItem(
      key: json['key'] as String,
      label: json['label'] as String,
      description: json['description'] as String? ?? '',
      configSchema: json['configSchema'] as Map<String, dynamic>? ?? const {},
    );
  }

  final String key;
  final String label;
  final String description;
  final Map<String, dynamic> configSchema;
}

class AutomationProviderCatalogItem {
  const AutomationProviderCatalogItem({
    required this.source,
    required this.label,
    required this.description,
    required this.syncSupport,
    required this.triggerKeys,
  });

  factory AutomationProviderCatalogItem.fromJson(Map<String, dynamic> json) {
    return AutomationProviderCatalogItem(
      source: json['source'] as String,
      label: json['label'] as String,
      description: json['description'] as String? ?? '',
      syncSupport: json['syncSupport'] as String? ?? 'manual',
      triggerKeys: (json['triggerKeys'] as List<dynamic>? ?? const [])
          .map((item) => item.toString())
          .toList(),
    );
  }

  final String source;
  final String label;
  final String description;
  final String syncSupport;
  final List<String> triggerKeys;
}
