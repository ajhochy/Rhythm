import '../../../app/core/utils/json_parsing.dart';

class MessageThreadParticipant {
  const MessageThreadParticipant({
    required this.id,
    required this.name,
    required this.email,
  });

  final int id;
  final String name;
  final String email;

  factory MessageThreadParticipant.fromJson(Map<String, dynamic> json) {
    return MessageThreadParticipant(
      id: asInt(json['id']) ?? 0,
      name: asString(json['name']) ?? '',
      email: asString(json['email']) ?? '',
    );
  }
}

class MessageThread {
  const MessageThread({
    required this.id,
    required this.title,
    this.lastMessage,
    required this.updatedAt,
    required this.unreadCount,
    this.participants = const [],
    this.threadType = 'direct',
  });

  final int id;
  final String title;
  final String? lastMessage;
  final DateTime updatedAt;
  final int unreadCount;
  final List<MessageThreadParticipant> participants;
  final String threadType;

  bool get isGroup => threadType == 'group';

  factory MessageThread.fromJson(Map<String, dynamic> json) {
    return MessageThread(
      id: asInt(json['id']) ?? 0,
      title: asString(json['title']) ?? '',
      lastMessage: asString(json['lastMessage']),
      updatedAt: _parseApiDateTime(asString(json['updatedAt'])),
      unreadCount: asInt(json['unreadCount']) ?? 0,
      participants: ((json['participants'] as List<dynamic>?) ?? const [])
          .map((item) =>
              MessageThreadParticipant.fromJson(item as Map<String, dynamic>))
          .toList(),
      threadType: asString(json['threadType']) ?? 'direct',
    );
  }

  bool get hasRecentActivity {
    final now = DateTime.now();
    return now.difference(updatedAt).inHours < 24;
  }

  bool get isUnread => unreadCount > 0;

  String displayTitleFor(int? currentUserId) {
    if (participants.isEmpty || currentUserId == null) {
      return title;
    }
    final others = participants.where((p) => p.id != currentUserId).toList();
    if (others.isEmpty) return title;
    return others.map((p) => p.name).join(', ');
  }
}

DateTime _parseApiDateTime(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) return DateTime.fromMillisecondsSinceEpoch(0);
  return parsed.isUtc ? parsed.toLocal() : parsed;
}
