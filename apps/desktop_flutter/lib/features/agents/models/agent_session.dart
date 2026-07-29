import '../../../app/core/utils/json_parsing.dart';

enum AgentSessionStatus {
  starting('starting'),
  working('working'),
  idle('idle'),
  resumable('resumable'),
  closed('closed'),

  /// OPC-M1-4: Persisted error state — replaces the old in-memory 5s setTimeout sentinel.
  /// Cleared only on an explicit user action (new prompt / resume).
  error('error');

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
    this.statusMessage,
    this.sessionToken,
    required this.cwd,
    required this.name,
    this.projectId,
    this.providerId,
    this.modelId,
    this.permissionMode = PermissionMode.defaultMode,
    this.thinkingBudget,
    this.fastMode = false,
    this.lastPreview,
    this.lastActivityAt,
    this.archivedAt,
    required this.createdAt,
    required this.updatedAt,
    this.parentId,
    this.sdkSessionId,
    this.anthropicAccountId,
    this.isSystem = false,
    this.category = 'chat',
    this.worktreeName,
    this.worktreePath,
    this.worktreeBranch,
  });

  final String id;
  final String? taskId;
  final String agentId;
  final AgentSessionStatus status;

  /// OPC-M1-4: Human-readable error message when status=error. Null otherwise.
  final String? statusMessage;
  final String? sessionToken;
  final String cwd;
  final String name;
  final String? projectId;
  final String? providerId;
  final String? modelId;
  final PermissionMode permissionMode;

  /// Reasoning budget in tokens (null = off). Only used when the model supports thinking.
  final int? thinkingBudget;

  /// When true, ask the SDK to use fast-mode (lower latency, less thorough).
  final bool fastMode;
  final String? lastPreview;
  final DateTime? lastActivityAt;
  final DateTime? archivedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// #743 — Local id of the parent session when this is a delegated subagent session.
  /// Null for top-level interactive sessions.
  final String? parentId;

  bool get isArchived => archivedAt != null;

  /// True when this session was spawned by a parent (delegated subagent).
  bool get isChildSession => parentId != null;

  /// #861 — the engine (opencode SDK) session id backing this local session,
  /// when known. Lets a delegated Task card resolve to the EXISTING local
  /// child session (persisted transcript) instead of refetching from the
  /// engine.
  final String? sdkSessionId;

  /// Anthropic account id this session is routed to (dual-account feature).
  /// Null means the app/profile default; updated live on spillover.
  final String? anthropicAccountId;

  /// #1090 — mirrors the server's `agent_sessions.is_system` column: true for
  /// background/system sessions (skill-extract, scheduler loops, memory
  /// consolidation) that must never surface in the normal chats list.
  final bool isSystem;

  /// #1090 — mirrors the server's `agent_sessions.category` column
  /// ('chat' | 'scheduled' | 'self_improvement'). Stamped at creation; drives
  /// which `AgentSessionScope` a session belongs to.
  final String category;

  /// OCU-17/18 (#1058/#1059) — when this session runs in an isolated git
  /// worktree, its name/directory/branch. All null for a normal session.
  final String? worktreeName;
  final String? worktreePath;
  final String? worktreeBranch;

  /// True when this session is running in an isolated git worktree.
  bool get isIsolatedWorktree => worktreePath != null;

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
      statusMessage: asString(json['statusMessage']),
      sessionToken: asString(json['sessionToken']),
      cwd: asString(json['cwd']) ?? '',
      name: asString(json['name']) ?? '',
      projectId: asString(json['projectId']),
      providerId: asString(json['providerId']),
      modelId: asString(json['modelId']),
      permissionMode: PermissionMode.fromWire(asString(json['permissionMode'])),
      thinkingBudget: json['thinkingBudget'] as int?,
      fastMode: json['fastMode'] as bool? ?? false,
      lastPreview: asString(json['lastPreview']),
      lastActivityAt: _parseDateTime(asString(json['lastActivityAt'])),
      archivedAt: _parseDateTime(asString(json['archivedAt'])),
      createdAt: _parseDateTime(asString(json['createdAt'])) ?? _epoch,
      updatedAt: _parseDateTime(asString(json['updatedAt'])) ?? _epoch,
      parentId: asString(json['parentSessionId']) ?? asString(json['parentId']),
      sdkSessionId:
          asString(json['sdkSessionId']) ?? asString(json['sdk_session_id']),
      anthropicAccountId: asString(json['anthropicAccountId']),
      isSystem: json['isSystem'] as bool? ?? false,
      category: asString(json['category']) ?? 'chat',
      worktreeName: asString(json['worktreeName']),
      worktreePath: asString(json['worktreePath']),
      worktreeBranch: asString(json['worktreeBranch']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      if (taskId != null) 'taskId': taskId,
      'agent_id': agentId,
      'status': status.wireValue,
      if (statusMessage != null) 'statusMessage': statusMessage,
      if (sessionToken != null) 'sessionToken': sessionToken,
      'cwd': cwd,
      'name': name,
      if (projectId != null) 'projectId': projectId,
      if (providerId != null) 'providerId': providerId,
      if (modelId != null) 'modelId': modelId,
      'permissionMode': permissionMode.wireValue,
      if (thinkingBudget != null) 'thinkingBudget': thinkingBudget,
      'fastMode': fastMode,
      if (lastPreview != null) 'lastPreview': lastPreview,
      if (lastActivityAt != null)
        'lastActivityAt': lastActivityAt!.toUtc().toIso8601String(),
      'archivedAt': archivedAt?.toUtc().toIso8601String(),
      'createdAt': createdAt.toUtc().toIso8601String(),
      'updatedAt': updatedAt.toUtc().toIso8601String(),
      if (parentId != null) 'parentSessionId': parentId,
      if (sdkSessionId != null) 'sdkSessionId': sdkSessionId,
      if (anthropicAccountId != null) 'anthropicAccountId': anthropicAccountId,
      if (worktreeName != null) 'worktreeName': worktreeName,
      if (worktreePath != null) 'worktreePath': worktreePath,
      if (worktreeBranch != null) 'worktreeBranch': worktreeBranch,
    };
  }

  AgentSession copyWith({
    String? id,
    Object? taskId = _sentinel,
    String? agentId,
    AgentSessionStatus? status,
    Object? statusMessage = _sentinel,
    Object? sessionToken = _sentinel,
    String? cwd,
    String? name,
    Object? providerId = _sentinel,
    Object? modelId = _sentinel,
    PermissionMode? permissionMode,
    Object? thinkingBudget = _sentinel,
    bool? fastMode,
    Object? lastPreview = _sentinel,
    Object? lastActivityAt = _sentinel,
    Object? archivedAt = _sentinel,
    DateTime? createdAt,
    DateTime? updatedAt,
    Object? parentId = _sentinel,
    Object? sdkSessionId = _sentinel,
    Object? anthropicAccountId = _sentinel,
    Object? worktreeName = _sentinel,
    Object? worktreePath = _sentinel,
    Object? worktreeBranch = _sentinel,
  }) {
    return AgentSession(
      id: id ?? this.id,
      taskId: taskId == _sentinel ? this.taskId : taskId as String?,
      agentId: agentId ?? this.agentId,
      status: status ?? this.status,
      statusMessage: statusMessage == _sentinel
          ? this.statusMessage
          : statusMessage as String?,
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
      thinkingBudget: thinkingBudget == _sentinel
          ? this.thinkingBudget
          : thinkingBudget as int?,
      fastMode: fastMode ?? this.fastMode,
      lastPreview:
          lastPreview == _sentinel ? this.lastPreview : lastPreview as String?,
      lastActivityAt: lastActivityAt == _sentinel
          ? this.lastActivityAt
          : lastActivityAt as DateTime?,
      archivedAt:
          archivedAt == _sentinel ? this.archivedAt : archivedAt as DateTime?,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      parentId: parentId == _sentinel ? this.parentId : parentId as String?,
      sdkSessionId: sdkSessionId == _sentinel
          ? this.sdkSessionId
          : sdkSessionId as String?,
      anthropicAccountId: anthropicAccountId == _sentinel
          ? this.anthropicAccountId
          : anthropicAccountId as String?,
      isSystem: isSystem,
      category: category,
      worktreeName: worktreeName == _sentinel
          ? this.worktreeName
          : worktreeName as String?,
      worktreePath: worktreePath == _sentinel
          ? this.worktreePath
          : worktreePath as String?,
      worktreeBranch: worktreeBranch == _sentinel
          ? this.worktreeBranch
          : worktreeBranch as String?,
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
  return parsed;
}
