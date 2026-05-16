import '../../../app/core/utils/json_parsing.dart';

enum AgentSessionStatus {
  starting('starting'),
  working('working'),
  idle('idle'),
  resumable('resumable'),
  closed('closed');

  final String wireValue;
  const AgentSessionStatus(this.wireValue);

  static AgentSessionStatus fromWire(String s) =>
      AgentSessionStatus.values.firstWhere(
        (k) => k.wireValue == s,
        orElse: () => AgentSessionStatus.closed,
      );
}

/// The four permission modes available for an agent session.
enum PermissionMode {
  /// Wait for user confirmation on every tool call.
  defaultMode('default'),

  /// Auto-accept write/edit tools; wait on others.
  acceptEdits('acceptEdits'),

  /// Auto-deny all tool calls (plan-only mode).
  plan('plan'),

  /// Auto-accept all tool calls without user confirmation.
  bypassPermissions('bypassPermissions');

  final String wireValue;
  const PermissionMode(this.wireValue);

  static PermissionMode fromWire(String? s) => PermissionMode.values.firstWhere(
        (m) => m.wireValue == s,
        orElse: () => PermissionMode.defaultMode,
      );

  String get displayLabel {
    switch (this) {
      case PermissionMode.defaultMode:
        return 'Default';
      case PermissionMode.acceptEdits:
        return 'Accept Edits';
      case PermissionMode.plan:
        return 'Plan Only';
      case PermissionMode.bypassPermissions:
        return 'Bypass All';
    }
  }

  String get description {
    switch (this) {
      case PermissionMode.defaultMode:
        return 'Prompt for every tool call.';
      case PermissionMode.acceptEdits:
        return 'Auto-accept write/edit tools; prompt for others.';
      case PermissionMode.plan:
        return 'Deny all tools — plan mode only.';
      case PermissionMode.bypassPermissions:
        return 'Auto-accept all tools without confirmation.';
    }
  }
}

class AgentSession {
  const AgentSession({
    required this.id,
    this.taskId,
    required this.agentId,
    required this.status,
    this.sessionToken,
    required this.cwd,
    required this.name,
    this.projectId,
    this.providerId,
    this.modelId,
    this.permissionMode = PermissionMode.defaultMode,
    this.lastPreview,
    this.lastActivityAt,
    this.archivedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? taskId;
  final String agentId;
  final AgentSessionStatus status;
  final String? sessionToken;
  final String cwd;
  final String name;
  final String? projectId;
  final String? providerId;
  final String? modelId;
  final PermissionMode permissionMode;
  final String? lastPreview;
  final DateTime? lastActivityAt;
  final DateTime? archivedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isArchived => archivedAt != null;

  factory AgentSession.fromJson(Map<String, dynamic> json) {
    // Accept `agent_id` (new) or fall back to `agent_kind` (legacy) for one
    // release, normalising the wire value to the canonical agentId string.
    final agentId = asString(json['agent_id']) ??
        asString(json['agentId']) ??
        asString(json['agent_kind']) ??
        asString(json['agentKind']) ??
        'claude-code';
    return AgentSession(
      id: asString(json['id']) ?? '',
      taskId: asString(json['taskId']),
      agentId: agentId,
      status: AgentSessionStatus.fromWire(asString(json['status']) ?? ''),
      sessionToken: asString(json['sessionToken']),
      cwd: asString(json['cwd']) ?? '',
      name: asString(json['name']) ?? '',
      projectId: asString(json['projectId']),
      providerId: asString(json['providerId']),
      modelId: asString(json['modelId']),
      permissionMode: PermissionMode.fromWire(asString(json['permissionMode'])),
      lastPreview: asString(json['lastPreview']),
      lastActivityAt: _parseDateTime(asString(json['lastActivityAt'])),
      archivedAt: _parseDateTime(asString(json['archivedAt'])),
      createdAt: _parseDateTime(asString(json['createdAt'])) ?? _epoch,
      updatedAt: _parseDateTime(asString(json['updatedAt'])) ?? _epoch,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      if (taskId != null) 'taskId': taskId,
      'agent_id': agentId,
      'status': status.wireValue,
      if (sessionToken != null) 'sessionToken': sessionToken,
      'cwd': cwd,
      'name': name,
      if (projectId != null) 'projectId': projectId,
      if (providerId != null) 'providerId': providerId,
      if (modelId != null) 'modelId': modelId,
      'permissionMode': permissionMode.wireValue,
      if (lastPreview != null) 'lastPreview': lastPreview,
      if (lastActivityAt != null)
        'lastActivityAt': lastActivityAt!.toUtc().toIso8601String(),
      'archivedAt': archivedAt?.toUtc().toIso8601String(),
      'createdAt': createdAt.toUtc().toIso8601String(),
      'updatedAt': updatedAt.toUtc().toIso8601String(),
    };
  }

  AgentSession copyWith({
    String? id,
    Object? taskId = _sentinel,
    String? agentId,
    AgentSessionStatus? status,
    Object? sessionToken = _sentinel,
    String? cwd,
    String? name,
    Object? providerId = _sentinel,
    Object? modelId = _sentinel,
    PermissionMode? permissionMode,
    Object? lastPreview = _sentinel,
    Object? lastActivityAt = _sentinel,
    Object? archivedAt = _sentinel,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return AgentSession(
      id: id ?? this.id,
      taskId: taskId == _sentinel ? this.taskId : taskId as String?,
      agentId: agentId ?? this.agentId,
      status: status ?? this.status,
      sessionToken: sessionToken == _sentinel
          ? this.sessionToken
          : sessionToken as String?,
      cwd: cwd ?? this.cwd,
      name: name ?? this.name,
      projectId: projectId,
      providerId:
          providerId == _sentinel ? this.providerId : providerId as String?,
      modelId: modelId == _sentinel ? this.modelId : modelId as String?,
      permissionMode: permissionMode ?? this.permissionMode,
      lastPreview:
          lastPreview == _sentinel ? this.lastPreview : lastPreview as String?,
      lastActivityAt: lastActivityAt == _sentinel
          ? this.lastActivityAt
          : lastActivityAt as DateTime?,
      archivedAt:
          archivedAt == _sentinel ? this.archivedAt : archivedAt as DateTime?,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

// Sentinel used for nullable copyWith parameters.
const Object _sentinel = Object();

final DateTime _epoch = DateTime.fromMillisecondsSinceEpoch(0);

DateTime? _parseDateTime(String? value) {
  if (value == null) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return null;
  return parsed.isUtc ? parsed.toLocal() : parsed;
}
