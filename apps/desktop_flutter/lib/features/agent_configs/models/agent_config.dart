import 'dart:convert';

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
    this.isManager = false,
    this.systemPrompt,
    this.allowedMcps,
    this.allowedSkills,
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
      isManager: asBool(json['isManager']) ?? false,
      systemPrompt: asString(json['systemPrompt']),
      allowedMcps:
          _parseStringList(json['allowedMcpsJson'] ?? json['allowedMcps']),
      allowedSkills:
          _parseStringList(json['allowedSkillsJson'] ?? json['allowedSkills']),
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

  /// True when this config is designated as the manager agent.
  /// Exactly one agent_config should have isManager = true.
  final bool isManager;

  /// Custom system prompt for this agent profile. Null means use the default.
  final String? systemPrompt;

  /// List of permitted MCP server IDs for this profile.
  final List<String>? allowedMcps;

  /// List of permitted skill names for this profile.
  final List<String>? allowedSkills;

  /// Returns true when this config was created from a preset.
  bool get isPreset => presetId != null;

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

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'icon': icon,
        'enabled': enabled,
        'isAgent': isAgent,
        'presetId': presetId,
        'sortOrder': sortOrder,
        'isManager': isManager,
        'systemPrompt': systemPrompt,
        'allowedMcpsJson': allowedMcps != null ? jsonEncode(allowedMcps) : null,
        'allowedSkillsJson':
            allowedSkills != null ? jsonEncode(allowedSkills) : null,
      };

  AgentConfig copyWith({
    String? label,
    String? icon,
    bool? enabled,
    bool? isAgent,
    Object? presetId = _sentinel,
    int? sortOrder,
    bool? isManager,
    Object? systemPrompt = _sentinel,
    Object? allowedMcps = _sentinel,
    Object? allowedSkills = _sentinel,
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
      isManager: isManager ?? this.isManager,
      systemPrompt: identical(systemPrompt, _sentinel)
          ? this.systemPrompt
          : systemPrompt as String?,
      allowedMcps: identical(allowedMcps, _sentinel)
          ? this.allowedMcps
          : allowedMcps as List<String>?,
      allowedSkills: identical(allowedSkills, _sentinel)
          ? this.allowedSkills
          : allowedSkills as List<String>?,
    );
  }
}

const Object _sentinel = Object();
