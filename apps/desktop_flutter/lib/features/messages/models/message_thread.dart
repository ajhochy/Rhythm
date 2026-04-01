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
      id: json['id'] as int,
      name: json['name'] as String,
      email: json['email'] as String,
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
  });

  final int id;
  final String title;
  final String? lastMessage;
  final DateTime updatedAt;
  final int unreadCount;
  final List<MessageThreadParticipant> participants;

  factory MessageThread.fromJson(Map<String, dynamic> json) {
    return MessageThread(
      id: json['id'] as int,
      title: json['title'] as String,
      lastMessage: json['lastMessage'] as String?,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      unreadCount: json['unreadCount'] as int? ?? 0,
      participants: ((json['participants'] as List<dynamic>?) ?? const [])
          .map((item) =>
              MessageThreadParticipant.fromJson(item as Map<String, dynamic>))
          .toList(),
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
