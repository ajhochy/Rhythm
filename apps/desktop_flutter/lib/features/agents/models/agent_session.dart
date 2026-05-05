import '../../../app/core/utils/json_parsing.dart';

enum AgentKind {
  claudeCode('claude-code'),
  codex('codex');

  final String wireValue;
  const AgentKind(this.wireValue);

  static AgentKind fromWire(String s) => AgentKind.values.firstWhere(
        (k) => k.wireValue == s,
        orElse: () => AgentKind.claudeCode,
      );
}

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

class AgentSession {
  const AgentSession({
    required this.id,
    this.taskId,
    required this.agentKind,
    required this.status,
    this.sessionToken,
    required this.cwd,
    required this.name,
    this.lastPreview,
    this.lastActivityAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? taskId;
  final AgentKind agentKind;
  final AgentSessionStatus status;
  final String? sessionToken;
  final String cwd;
  final String name;
  final String? lastPreview;
  final DateTime? lastActivityAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory AgentSession.fromJson(Map<String, dynamic> json) {
    return AgentSession(
      id: asString(json['id']) ?? '',
      taskId: asString(json['taskId']),
      agentKind: AgentKind.fromWire(asString(json['agentKind']) ?? ''),
      status: AgentSessionStatus.fromWire(asString(json['status']) ?? ''),
      sessionToken: asString(json['sessionToken']),
      cwd: asString(json['cwd']) ?? '',
      name: asString(json['name']) ?? '',
      lastPreview: asString(json['lastPreview']),
      lastActivityAt: _parseDateTime(asString(json['lastActivityAt'])),
      createdAt: _parseDateTime(asString(json['createdAt'])) ?? _epoch,
      updatedAt: _parseDateTime(asString(json['updatedAt'])) ?? _epoch,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      if (taskId != null) 'taskId': taskId,
      'agentKind': agentKind.wireValue,
      'status': status.wireValue,
      if (sessionToken != null) 'sessionToken': sessionToken,
      'cwd': cwd,
      'name': name,
      if (lastPreview != null) 'lastPreview': lastPreview,
      if (lastActivityAt != null)
        'lastActivityAt': lastActivityAt!.toUtc().toIso8601String(),
      'createdAt': createdAt.toUtc().toIso8601String(),
      'updatedAt': updatedAt.toUtc().toIso8601String(),
    };
  }

  AgentSession copyWith({
    String? id,
    Object? taskId = _sentinel,
    AgentKind? agentKind,
    AgentSessionStatus? status,
    Object? sessionToken = _sentinel,
    String? cwd,
    String? name,
    Object? lastPreview = _sentinel,
    Object? lastActivityAt = _sentinel,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return AgentSession(
      id: id ?? this.id,
      taskId: taskId == _sentinel ? this.taskId : taskId as String?,
      agentKind: agentKind ?? this.agentKind,
      status: status ?? this.status,
      sessionToken: sessionToken == _sentinel
          ? this.sessionToken
          : sessionToken as String?,
      cwd: cwd ?? this.cwd,
      name: name ?? this.name,
      lastPreview:
          lastPreview == _sentinel ? this.lastPreview : lastPreview as String?,
      lastActivityAt: lastActivityAt == _sentinel
          ? this.lastActivityAt
          : lastActivityAt as DateTime?,
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
