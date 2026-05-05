import '../../../app/core/utils/json_parsing.dart';

class AgentSessionMessage {
  const AgentSessionMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.rawText,
    required this.strippedText,
    required this.createdAt,
  });

  final int id;
  final String sessionId;

  /// One of: 'output' | 'input' | 'system'
  final String role;
  final String rawText;
  final String strippedText;
  final DateTime createdAt;

  factory AgentSessionMessage.fromJson(Map<String, dynamic> json) {
    return AgentSessionMessage(
      id: asInt(json['id']) ?? 0,
      sessionId: asString(json['sessionId']) ?? '',
      role: asString(json['role']) ?? 'output',
      rawText: asString(json['rawText']) ?? '',
      strippedText: asString(json['strippedText']) ?? '',
      createdAt: _parseDateTime(asString(json['createdAt'])),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'sessionId': sessionId,
      'role': role,
      'rawText': rawText,
      'strippedText': strippedText,
      'createdAt': createdAt.toUtc().toIso8601String(),
    };
  }
}

DateTime _parseDateTime(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return DateTime.fromMillisecondsSinceEpoch(0);
  return parsed.isUtc ? parsed.toLocal() : parsed;
}
