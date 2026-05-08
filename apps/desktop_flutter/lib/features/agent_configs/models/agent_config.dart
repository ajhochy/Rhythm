import '../../../app/core/utils/json_parsing.dart';

class AgentConfig {
  AgentConfig({
    required this.id,
    required this.label,
    required this.icon,
    required this.command,
    required this.enabled,
    required this.isAgent,
    required this.canResume,
    required this.sortOrder,
    this.resumeCommand,
    this.sessionIdPattern,
    this.outputMarker,
    this.presetId,
  });

  factory AgentConfig.fromJson(Map<String, dynamic> json) {
    return AgentConfig(
      id: asString(json['id']) ?? '',
      label: asString(json['label']) ?? '',
      icon: asString(json['icon']) ?? '',
      command: asString(json['command']) ?? '',
      enabled: asBool(json['enabled']) ?? true,
      isAgent: asBool(json['isAgent']) ?? false,
      canResume: asBool(json['canResume']) ?? false,
      resumeCommand: asString(json['resumeCommand']),
      sessionIdPattern: asString(json['sessionIdPattern']),
      outputMarker: asString(json['outputMarker']),
      presetId: asString(json['presetId']),
      sortOrder: asInt(json['sortOrder']) ?? 0,
    );
  }

  final String id;
  final String label;

  /// Asset path string; the UI layer resolves this to an actual widget.
  final String icon;

  final String command;
  final bool enabled;
  final bool isAgent;
  final bool canResume;
  final String? resumeCommand;
  final String? sessionIdPattern;
  final String? outputMarker;

  /// Non-null means this config was created from a built-in preset.
  final String? presetId;

  final int sortOrder;

  /// Returns true when this config was created from a preset.
  bool get isPreset => presetId != null;

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'icon': icon,
        'command': command,
        'enabled': enabled,
        'isAgent': isAgent,
        'canResume': canResume,
        'resumeCommand': resumeCommand,
        'sessionIdPattern': sessionIdPattern,
        'outputMarker': outputMarker,
        'presetId': presetId,
        'sortOrder': sortOrder,
      };

  AgentConfig copyWith({
    String? label,
    String? icon,
    String? command,
    bool? enabled,
    bool? isAgent,
    bool? canResume,
    Object? resumeCommand = _sentinel,
    Object? sessionIdPattern = _sentinel,
    Object? outputMarker = _sentinel,
    Object? presetId = _sentinel,
    int? sortOrder,
  }) {
    return AgentConfig(
      id: id,
      label: label ?? this.label,
      icon: icon ?? this.icon,
      command: command ?? this.command,
      enabled: enabled ?? this.enabled,
      isAgent: isAgent ?? this.isAgent,
      canResume: canResume ?? this.canResume,
      resumeCommand: identical(resumeCommand, _sentinel)
          ? this.resumeCommand
          : resumeCommand as String?,
      sessionIdPattern: identical(sessionIdPattern, _sentinel)
          ? this.sessionIdPattern
          : sessionIdPattern as String?,
      outputMarker: identical(outputMarker, _sentinel)
          ? this.outputMarker
          : outputMarker as String?,
      presetId:
          identical(presetId, _sentinel) ? this.presetId : presetId as String?,
      sortOrder: sortOrder ?? this.sortOrder,
    );
  }
}

const Object _sentinel = Object();
