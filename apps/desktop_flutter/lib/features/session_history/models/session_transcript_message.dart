import '../../../app/core/utils/json_parsing.dart';

class SessionTranscriptMessage {
  const SessionTranscriptMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.text,
    required this.createdAt,
  });

  factory SessionTranscriptMessage.fromJson(Map<String, dynamic> json) {
    return SessionTranscriptMessage(
      id: asInt(json['id']) ?? 0,
      sessionId: asString(json['sessionId']) ?? '',
      role: asString(json['role']) ?? 'output',
      text: _messageText(json),
      createdAt: _parseDateTime(asString(json['createdAt'])),
    );
  }

  final int id;
  final String sessionId;
  final String role;
  final String text;
  final DateTime createdAt;

  String get roleLabel {
    switch (role) {
      case 'input':
        return 'Input';
      case 'system':
        return 'System';
      case 'output':
      default:
        return 'Output';
    }
  }

  static String _messageText(Map<String, dynamic> json) {
    final stripped = asString(json['strippedText']);
    if (stripped != null && stripped.trim().isNotEmpty) return stripped;

    final raw = asString(json['rawText']);
    if (raw != null && raw.trim().isNotEmpty) return raw;

    final parts = json['parts'];
    if (parts is List) {
      final chunks = <String>[];
      for (final part in parts) {
        if (part is! Map<String, dynamic>) continue;
        final text = asString(part['text']) ??
            asString(part['content']) ??
            asString(part['message']);
        if (text != null && text.trim().isNotEmpty) {
          chunks.add(text.trim());
        } else {
          final type = asString(part['type']);
          if (type != null && type.trim().isNotEmpty) {
            chunks.add('[$type]');
          }
        }
      }
      if (chunks.isNotEmpty) return chunks.join('\n\n');
    }

    return '';
  }
}

DateTime _parseDateTime(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return DateTime.fromMillisecondsSinceEpoch(0);
  return parsed;
}
