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
      case 'trigger.fired':
        return TriggerFiredMessage.fromJson(json);
      case 'notification.push':
        return NotificationPushMessage.fromJson(json);
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
  });

  final String id;
  final bool working;
  final String source;

  factory SessionStatusMessage.fromJson(Map<String, dynamic> json) {
    return SessionStatusMessage(
      id: asString(json['id']) ?? '',
      working: (json['working'] as bool?) ?? false,
      source: asString(json['source']) ?? '',
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
  const WsErrorMessage({required this.message});

  final String message;

  factory WsErrorMessage.fromJson(Map<String, dynamic> json) {
    return WsErrorMessage(
      message: asString(json['message']) ?? '',
    );
  }
}

class UnknownWsMessage extends AgentWsMessage {
  const UnknownWsMessage(this.rawType);

  final String rawType;
}
