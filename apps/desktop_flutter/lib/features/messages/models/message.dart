import '../../../app/core/utils/json_parsing.dart';

class Message {
  const Message({
    required this.id,
    required this.threadId,
    required this.senderName,
    required this.content,
    required this.createdAt,
  });

  final int id;
  final int threadId;
  final String senderName;
  final String content;
  final DateTime createdAt;

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: asInt(json['id']) ?? 0,
      threadId: asInt(json['threadId']) ?? 0,
      senderName: asString(json['senderName']) ?? '',
      content: asString(json['body']) ?? '',
      createdAt: _parseApiDateTime(asString(json['createdAt'])),
    );
  }
}

DateTime _parseApiDateTime(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return DateTime.fromMillisecondsSinceEpoch(0);
  return parsed.isUtc ? parsed.toLocal() : parsed;
}
