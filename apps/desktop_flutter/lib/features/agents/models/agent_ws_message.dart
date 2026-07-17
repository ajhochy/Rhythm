import '../../../app/core/utils/json_parsing.dart';
import 'agent_session.dart';

/// Sealed-like hierarchy for messages received over the WebSocket connection.
abstract class AgentWsMessage {
  const AgentWsMessage();

  /// Parse a decoded JSON map into the appropriate [AgentWsMessage] subtype.
  static AgentWsMessage parse(Map<String, dynamic> json) {
    final type = json['type'] as String?;
    switch (type) {
      case 'sessions.list':
        return SessionsListMessage.fromJson(json);
      case 'session.created':
        return SessionCreatedMessage.fromJson(json);
      case 'session.closed':
        return SessionClosedMessage.fromJson(json);
      case 'session.status':
        return SessionStatusMessage.fromJson(json);
      case 'output':
        return OutputMessage.fromJson(json);
      case 'transcript.append':
        return TranscriptAppendMessage.fromJson(json);
      case 'message.updated':
        return MessageUpdatedMessage.fromJson(json);
      case 'message.part.updated':
        return MessagePartUpdatedMessage.fromJson(json);
      case 'message.part.delta':
        return MessagePartDeltaMessage.fromJson(json);
      case 'message.removed':
        return MessageRemovedMessage.fromJson(json);
      case 'session.updated':
        return SessionUpdatedMessage.fromJson(json);
      case 'session.removed':
        return SessionRemovedMessage.fromJson(json);
      case 'agent-configs.changed':
        return const AgentConfigsChangedMessage();
      case 'trigger.fired':
        return TriggerFiredMessage.fromJson(json);
      case 'notification.push':
        return NotificationPushMessage.fromJson(json);
      case 'permission.asked':
        return PermissionAskedMessage.fromJson(json);
      case 'permission.resolved':
        return PermissionResolvedMessage.fromJson(json);
      case 'question.asked':
        return QuestionAskedMessage.fromJson(json);
      case 'question.resolved':
        return QuestionResolvedMessage.fromJson(json);
      case 'session.diff':
        return SessionDiffMessage.fromJson(json);
      case 'session.compacted':
        return SessionCompactedMessage.fromJson(json);
      case 'todo.updated':
        return SessionTodoUpdatedMessage.fromJson(json);
      case 'session.spillover':
        return SessionSpilloverMessage.fromJson(json);
      case 'vcs.branch.updated':
        return VcsBranchUpdatedMessage.fromJson(json);
      case 'error':
        return WsErrorMessage.fromJson(json);
      default:
        return UnknownWsMessage(type ?? '');
    }
  }
}

// ---------------------------------------------------------------------------
// Concrete message types
// ---------------------------------------------------------------------------

class SessionsListMessage extends AgentWsMessage {
  const SessionsListMessage({
    required this.sessions,
    required this.resumable,
  });

  final List<AgentSession> sessions;
  final List<AgentSession> resumable;

  factory SessionsListMessage.fromJson(Map<String, dynamic> json) {
    List<AgentSession> parseList(dynamic raw) {
      if (raw is! List) return const [];
      return raw
          .whereType<Map<String, dynamic>>()
          .map(AgentSession.fromJson)
          .toList();
    }

    return SessionsListMessage(
      sessions: parseList(json['sessions']),
      resumable: parseList(json['resumable']),
    );
  }
}

class SessionCreatedMessage extends AgentWsMessage {
  const SessionCreatedMessage({required this.session});

  final AgentSession session;

  factory SessionCreatedMessage.fromJson(Map<String, dynamic> json) {
    return SessionCreatedMessage(
      session: AgentSession.fromJson(
        json['session'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }
}

class SessionClosedMessage extends AgentWsMessage {
  const SessionClosedMessage({required this.id, required this.resumable});

  final String id;
  final bool resumable;

  factory SessionClosedMessage.fromJson(Map<String, dynamic> json) {
    return SessionClosedMessage(
      id: asString(json['id']) ?? '',
      resumable: (json['resumable'] as bool?) ?? false,
    );
  }
}

class SessionStatusMessage extends AgentWsMessage {
  const SessionStatusMessage({
    required this.id,
    required this.working,
    required this.source,
    this.status,
    this.attempt,
    this.reason,
  });

  final String id;
  final bool working;
  final String source;

  /// OPC-M2-4: the raw status string from the bridge ('busy', 'idle', 'retrying').
  final String? status;

  /// OPC-M2-4: retry attempt count (only present when status == 'retrying').
  final int? attempt;

  /// OPC-M2-4: retry reason string (only present when status == 'retrying').
  final String? reason;

  bool get isRetrying => status == 'retrying';

  factory SessionStatusMessage.fromJson(Map<String, dynamic> json) {
    return SessionStatusMessage(
      id: asString(json['id']) ?? '',
      working: (json['working'] as bool?) ?? false,
      source: asString(json['source']) ?? '',
      status: asString(json['status']),
      attempt: asInt(json['attempt']),
      reason: asString(json['reason']),
    );
  }
}

class OutputMessage extends AgentWsMessage {
  const OutputMessage({
    required this.id,
    required this.data,
    required this.replay,
  });

  final String id;
  final String data;
  final bool replay;

  factory OutputMessage.fromJson(Map<String, dynamic> json) {
    return OutputMessage(
      id: asString(json['id']) ?? '',
      data: asString(json['data']) ?? '',
      replay: (json['replay'] as bool?) ?? false,
    );
  }
}

class TranscriptAppendMessage extends AgentWsMessage {
  const TranscriptAppendMessage({
    required this.id,
    required this.role,
    required this.text,
  });

  final String id;
  final String role;
  final String text;

  factory TranscriptAppendMessage.fromJson(Map<String, dynamic> json) {
    return TranscriptAppendMessage(
      id: asString(json['id']) ?? '',
      role: asString(json['role']) ?? '',
      text: asString(json['text']) ?? '',
    );
  }
}

class TriggerFiredMessage extends AgentWsMessage {
  const TriggerFiredMessage({
    required this.taskId,
    required this.taskTitle,
    this.triggeredByUserId,
  });

  final String taskId;
  final String taskTitle;
  final int? triggeredByUserId;

  factory TriggerFiredMessage.fromJson(Map<String, dynamic> json) {
    return TriggerFiredMessage(
      taskId: asString(json['taskId']) ?? '',
      taskTitle: asString(json['taskTitle']) ?? '',
      triggeredByUserId: asInt(json['triggeredByUserId']),
    );
  }
}

class NotificationPushMessage extends AgentWsMessage {
  const NotificationPushMessage({
    required this.id,
    required this.title,
    required this.body,
  });

  final int id;
  final String title;
  final String body;

  factory NotificationPushMessage.fromJson(Map<String, dynamic> json) {
    return NotificationPushMessage(
      id: asInt(json['id']) ?? 0,
      title: asString(json['title']) ?? '',
      body: asString(json['body']) ?? '',
    );
  }
}

class WsErrorMessage extends AgentWsMessage {
  const WsErrorMessage({required this.id, required this.message});

  final String id;
  final String message;

  factory WsErrorMessage.fromJson(Map<String, dynamic> json) {
    return WsErrorMessage(
      id: asString(json['id']) ?? '',
      message: asString(json['message']) ?? '',
    );
  }
}

/// Opencode SDK `message.updated` event forwarded by the api_server bridge.
/// `info` is the SDK Message object: { id, sessionID, role, time, cost, tokens, ... }.
class MessageUpdatedMessage extends AgentWsMessage {
  const MessageUpdatedMessage({
    required this.sessionId,
    required this.info,
  });

  final String sessionId;
  final Map<String, dynamic> info;

  String get messageId => asString(info['id']) ?? '';
  String get role => asString(info['role']) ?? 'assistant';

  /// OPC-M2-4: cost in USD (null for user messages / legacy rows without cost).
  double? get cost => (info['cost'] as num?)?.toDouble();

  /// OPC-M2-4: token usage map (input/output/reasoning/cache). May be null.
  Map<String, dynamic>? get tokens {
    final t = info['tokens'];
    if (t is Map<String, dynamic>) return t;
    return null;
  }

  factory MessageUpdatedMessage.fromJson(Map<String, dynamic> json) {
    return MessageUpdatedMessage(
      sessionId: asString(json['id']) ?? '',
      info: (json['info'] as Map<String, dynamic>?) ?? const {},
    );
  }
}

/// Opencode SDK `message.part.updated` event. `part` is { id, messageID,
/// sessionID, type, text?, ... }.
class MessagePartUpdatedMessage extends AgentWsMessage {
  const MessagePartUpdatedMessage({
    required this.sessionId,
    required this.part,
  });

  final String sessionId;
  final Map<String, dynamic> part;

  String get partId => asString(part['id']) ?? '';
  String get messageId => asString(part['messageID']) ?? '';
  String get partType => asString(part['type']) ?? 'text';
  String get text => asString(part['text']) ?? '';

  factory MessagePartUpdatedMessage.fromJson(Map<String, dynamic> json) {
    return MessagePartUpdatedMessage(
      sessionId: asString(json['id']) ?? '',
      part: (json['part'] as Map<String, dynamic>?) ?? const {},
    );
  }
}

/// Opencode SDK `message.part.delta` event — append `delta` to part[field].
class MessagePartDeltaMessage extends AgentWsMessage {
  const MessagePartDeltaMessage({
    required this.sessionId,
    required this.messageId,
    required this.partId,
    required this.field,
    required this.delta,
  });

  final String sessionId;
  final String messageId;
  final String partId;
  final String field;
  final String delta;

  factory MessagePartDeltaMessage.fromJson(Map<String, dynamic> json) {
    return MessagePartDeltaMessage(
      sessionId: asString(json['id']) ?? '',
      messageId: asString(json['messageId']) ?? '',
      partId: asString(json['partId']) ?? '',
      field: asString(json['field']) ?? 'text',
      delta: asString(json['delta']) ?? '',
    );
  }
}

class MessageRemovedMessage extends AgentWsMessage {
  const MessageRemovedMessage({
    required this.sessionId,
    required this.messageId,
  });

  final String sessionId;
  final String messageId;

  factory MessageRemovedMessage.fromJson(Map<String, dynamic> json) {
    return MessageRemovedMessage(
      sessionId: asString(json['id']) ?? '',
      messageId: asString(json['messageId']) ?? '',
    );
  }
}

/// #605 — server broadcast of a full updated session row.
/// Received whenever the server mutates a session (status change, rename,
/// archive toggle, etc.). The client should upsert the row in its local cache.
class SessionUpdatedMessage extends AgentWsMessage {
  const SessionUpdatedMessage({required this.session});

  final AgentSession session;

  factory SessionUpdatedMessage.fromJson(Map<String, dynamic> json) {
    return SessionUpdatedMessage(
      session: AgentSession.fromJson(
        (json['session'] as Map<String, dynamic>?) ?? const {},
      ),
    );
  }
}

/// #605 — server broadcast of a hard-deleted session.
/// Received after `DELETE /agent-sessions/:id/hard`. The client should drop
/// the row from all local caches.
class SessionRemovedMessage extends AgentWsMessage {
  const SessionRemovedMessage({required this.id});

  final String id;

  factory SessionRemovedMessage.fromJson(Map<String, dynamic> json) {
    return SessionRemovedMessage(id: asString(json['id']) ?? '');
  }
}

/// Server broadcast after an agent profile is created, updated, deleted, or
/// re-synced to disk. Consumers should refresh profile-derived caches.
class AgentConfigsChangedMessage extends AgentWsMessage {
  const AgentConfigsChangedMessage();
}

/// #608 — server broadcast when the SDK emits `permission.asked`.
/// The client should surface a [PermissionCard] for this session.
class PermissionAskedMessage extends AgentWsMessage {
  const PermissionAskedMessage({
    required this.sessionId,
    required this.permissionId,
    required this.toolName,
    required this.args,
    required this.summary,
  });

  final String sessionId;
  final String permissionId;
  final String toolName;
  final Map<String, dynamic> args;
  final String summary;

  factory PermissionAskedMessage.fromJson(Map<String, dynamic> json) {
    return PermissionAskedMessage(
      sessionId: asString(json['sessionId']) ?? '',
      permissionId: asString(json['permissionId']) ?? '',
      toolName: asString(json['toolName']) ?? '',
      args: (json['args'] as Map<String, dynamic>?) ?? const {},
      summary: asString(json['summary']) ?? '',
    );
  }
}

/// #608 — server broadcast when a permission has been resolved (accepted or denied),
/// either by the user or by the permission-mode auto-logic.
class PermissionResolvedMessage extends AgentWsMessage {
  const PermissionResolvedMessage({
    required this.sessionId,
    required this.permissionId,
    required this.decision,
  });

  final String sessionId;
  final String permissionId;

  /// Either 'accept' or 'deny'.
  final String decision;

  factory PermissionResolvedMessage.fromJson(Map<String, dynamic> json) {
    return PermissionResolvedMessage(
      sessionId: asString(json['sessionId']) ?? '',
      permissionId: asString(json['permissionId']) ?? '',
      decision: asString(json['decision']) ?? 'deny',
    );
  }
}

/// Server broadcast when opencode emits `question.asked` (the agent called its
/// `question`/AskUserQuestion tool). Carries the opencode requestId, the tool
/// [callId] (correlates to the rendered tool part), and the authoritative
/// question list. The client answers via the question-reply REST path.
class QuestionAskedMessage extends AgentWsMessage {
  const QuestionAskedMessage({
    required this.sessionId,
    required this.requestId,
    required this.callId,
    required this.questions,
  });

  final String sessionId;
  final String requestId;
  final String callId;
  final List<dynamic> questions;

  factory QuestionAskedMessage.fromJson(Map<String, dynamic> json) {
    return QuestionAskedMessage(
      sessionId: asString(json['sessionId']) ?? '',
      requestId: asString(json['requestId']) ?? '',
      callId: asString(json['callId']) ?? '',
      questions: (json['questions'] as List<dynamic>?) ?? const [],
    );
  }
}

/// Server broadcast when a pending question is resolved (answered, dismissed,
/// or resolved by another client). The card should stop offering an answer.
class QuestionResolvedMessage extends AgentWsMessage {
  const QuestionResolvedMessage({
    required this.sessionId,
    required this.requestId,
    required this.rejected,
  });

  final String sessionId;
  final String requestId;
  final bool rejected;

  factory QuestionResolvedMessage.fromJson(Map<String, dynamic> json) {
    return QuestionResolvedMessage(
      sessionId: asString(json['sessionId']) ?? '',
      requestId: asString(json['requestId']) ?? '',
      rejected: json['rejected'] == true,
    );
  }
}

/// OPC-M3-1 — `session.diff` event relayed by the bridge when the SDK fires a
/// diff event. The event carries only the local session id — the Flutter client
/// must call `GET /agent-sessions/:id/diff` to get the full FileDiff payload.
class SessionDiffMessage extends AgentWsMessage {
  const SessionDiffMessage({required this.id});

  /// Local (Rhythm) session id.
  final String id;

  factory SessionDiffMessage.fromJson(Map<String, dynamic> json) {
    return SessionDiffMessage(
      id: asString(json['id']) ?? '',
    );
  }
}

/// #720 — `session.compacted` event relayed by the bridge when opencode
/// signals compaction completion. opencode emits this event (NOT a live
/// `compaction` message-part), so the client clears the compacting spinner and
/// rehydrates the session (re-fetch messages) — the persisted CompactionPart
/// then renders as the "Conversation compacted" divider, and the context gauge
/// reflects the post-compaction tokens. Carries only the local session id.
class SessionCompactedMessage extends AgentWsMessage {
  const SessionCompactedMessage({required this.id});

  /// Local (Rhythm) session id.
  final String id;

  factory SessionCompactedMessage.fromJson(Map<String, dynamic> json) {
    return SessionCompactedMessage(
      id: asString(json['id']) ?? '',
    );
  }
}

/// OPC-M3-5 — `todo.updated` event relayed by the bridge when the SDK fires a
/// todo update. Carries the full todo list for the session so the Flutter todo
/// panel can update without a REST round-trip.
class SessionTodoUpdatedMessage extends AgentWsMessage {
  const SessionTodoUpdatedMessage({
    required this.sessionId,
    required this.todos,
  });

  /// Local (Rhythm) session id.
  final String sessionId;

  /// Full list of todos for the session, each with id, content, status, priority.
  final List<Map<String, dynamic>> todos;

  factory SessionTodoUpdatedMessage.fromJson(Map<String, dynamic> json) {
    final rawTodos = json['todos'];
    final todos = rawTodos is List
        ? rawTodos.whereType<Map<String, dynamic>>().toList()
        : const <Map<String, dynamic>>[];
    return SessionTodoUpdatedMessage(
      sessionId: asString(json['id']) ?? '',
      todos: todos,
    );
  }
}

/// Dual-account spillover: the engine plugin failed a session over to the
/// other Anthropic account after a rate limit; api_server broadcasts
/// `{v:1, type:'session.spillover', sessionId, fromAccountId, toAccountId,
/// reason}` with the LOCAL session id.
class SessionSpilloverMessage extends AgentWsMessage {
  const SessionSpilloverMessage({
    required this.sessionId,
    required this.fromAccountId,
    required this.toAccountId,
  });

  final String sessionId;
  final String fromAccountId;
  final String toAccountId;

  factory SessionSpilloverMessage.fromJson(Map<String, dynamic> json) {
    return SessionSpilloverMessage(
      sessionId: asString(json['sessionId']) ?? '',
      fromAccountId: asString(json['fromAccountId']) ?? '',
      toAccountId: asString(json['toAccountId']) ?? '',
    );
  }
}

/// OCU-22 (#1063) — `vcs.branch.updated` is project-scoped (no sessionID; the
/// bridge relays it as a bare top-level frame). [branch] is the new branch
/// name when known. The client refetches vcs info for the selected session on
/// receipt since the frame doesn't identify which directory changed.
class VcsBranchUpdatedMessage extends AgentWsMessage {
  const VcsBranchUpdatedMessage({this.branch});

  final String? branch;

  factory VcsBranchUpdatedMessage.fromJson(Map<String, dynamic> json) {
    return VcsBranchUpdatedMessage(branch: asString(json['branch']));
  }
}

class UnknownWsMessage extends AgentWsMessage {
  const UnknownWsMessage(this.rawType);

  final String rawType;
}
