import '../../../app/core/utils/json_parsing.dart';

enum SessionHistoryStatus {
  running,
  completed,
  failed;

  static SessionHistoryStatus fromWire(String? value) {
    switch (value) {
      case 'starting':
      case 'working':
      case 'idle':
      case 'resumable':
        return SessionHistoryStatus.running;
      case 'error':
        return SessionHistoryStatus.failed;
      case 'closed':
      default:
        return SessionHistoryStatus.completed;
    }
  }

  String get label {
    switch (this) {
      case SessionHistoryStatus.running:
        return 'Running';
      case SessionHistoryStatus.completed:
        return 'Completed';
      case SessionHistoryStatus.failed:
        return 'Failed';
    }
  }
}

enum SessionHistorySource {
  cookbook,
  scheduledTask;

  String get label {
    switch (this) {
      case SessionHistorySource.cookbook:
        return 'Cookbook';
      case SessionHistorySource.scheduledTask:
        return 'Scheduled Task';
    }
  }
}

class SessionHistoryAgentSession {
  const SessionHistoryAgentSession({
    required this.id,
    required this.startTime,
    required this.status,
    required this.agentOrRecipeName,
    required this.source,
    this.rawStatus,
    this.statusMessage,
    this.agentName,
  });

  factory SessionHistoryAgentSession.fromJson(
    Map<String, dynamic> json, {
    required SessionHistorySource source,
    String? sourceName,
  }) {
    final name = asString(json['name']) ?? '';
    final agent = asString(json['agentId']) ??
        asString(json['agent_id']) ??
        asString(json['agentKind']) ??
        asString(json['agent_kind']);
    final rawStatus = asString(json['status']);
    final started = _parseDateTime(
          asString(json['createdAt']) ?? asString(json['created_at']),
        ) ??
        DateTime.fromMillisecondsSinceEpoch(0);

    return SessionHistoryAgentSession(
      id: asString(json['id']) ?? '',
      startTime: started,
      status: SessionHistoryStatus.fromWire(rawStatus),
      agentOrRecipeName: _displayName(
        source: source,
        sourceName: sourceName,
        sessionName: name,
      ),
      source: source,
      rawStatus: rawStatus,
      statusMessage: asString(json['statusMessage']),
      agentName: agent,
    );
  }

  final String id;
  final DateTime startTime;
  final SessionHistoryStatus status;
  final String agentOrRecipeName;
  final SessionHistorySource source;
  final String? rawStatus;
  final String? statusMessage;
  final String? agentName;

  static String _displayName({
    required SessionHistorySource source,
    required String? sourceName,
    required String sessionName,
  }) {
    final trimmedSource = sourceName?.trim();
    if (trimmedSource != null && trimmedSource.isNotEmpty) {
      return trimmedSource;
    }
    final trimmedSession = sessionName.trim();
    if (trimmedSession.isNotEmpty && trimmedSession != 'AgentRunner run') {
      return trimmedSession;
    }
    return source == SessionHistorySource.cookbook
        ? 'Cookbook recipe'
        : 'Scheduled task';
  }
}

DateTime? _parseDateTime(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return null;
  return parsed.isUtc ? parsed.toLocal() : parsed;
}
