import '../../../app/core/utils/json_parsing.dart';

/// Agent configuration as surfaced to the UI.
///
/// Legacy CLI fields (`command`, `canResume`, `resumeCommand`,
/// `sessionIdPattern`, `outputMarker`) were removed in #575 when the Opencode
/// SDK replaced the PTY/CLI-subprocess execution path. The corresponding DB
/// columns remain in the schema for backward compatibility but are no longer
/// read or written by the client.
class AgentConfig {
  AgentConfig({
    required this.id,
    required this.label,
    required this.icon,
    required this.enabled,
    required this.isAgent,
    required this.sortOrder,
    this.presetId,
  });

  factory AgentConfig.fromJson(Map<String, dynamic> json) {
    return AgentConfig(
      id: asString(json['id']) ?? '',
      label: asString(json['label']) ?? '',
      icon: asString(json['icon']) ?? '',
      enabled: asBool(json['enabled']) ?? true,
      isAgent: asBool(json['isAgent']) ?? false,
      presetId: asString(json['presetId']),
      sortOrder: asInt(json['sortOrder']) ?? 0,
    );
  }

  final String id;
  final String label;

  /// Asset path string; the UI layer resolves this to an actual widget.
  final String icon;

  final bool enabled;
  final bool isAgent;

  /// Non-null means this config was created from a built-in preset.
  final String? presetId;

  final int sortOrder;

  /// Returns true when this config was created from a preset.
  bool get isPreset => presetId != null;

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'icon': icon,
        'enabled': enabled,
        'isAgent': isAgent,
        'presetId': presetId,
        'sortOrder': sortOrder,
      };

  AgentConfig copyWith({
    String? label,
    String? icon,
    bool? enabled,
    bool? isAgent,
    Object? presetId = _sentinel,
    int? sortOrder,
  }) {
    return AgentConfig(
      id: id,
      label: label ?? this.label,
      icon: icon ?? this.icon,
      enabled: enabled ?? this.enabled,
      isAgent: isAgent ?? this.isAgent,
      presetId:
          identical(presetId, _sentinel) ? this.presetId : presetId as String?,
      sortOrder: sortOrder ?? this.sortOrder,
    );
  }
}

const Object _sentinel = Object();
