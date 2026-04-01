class MessageThread {
  const MessageThread({
    required this.id,
    required this.title,
    this.lastMessage,
    required this.updatedAt,
    required this.unreadCount,
  });

  final int id;
  final String title;
  final String? lastMessage;
  final DateTime updatedAt;
  final int unreadCount;

  factory MessageThread.fromJson(Map<String, dynamic> json) {
    return MessageThread(
      id: json['id'] as int,
      title: json['title'] as String,
      lastMessage: json['lastMessage'] as String?,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      unreadCount: json['unreadCount'] as int? ?? 0,
    );
  }

  bool get hasRecentActivity {
    final now = DateTime.now();
    return now.difference(updatedAt).inHours < 24;
  }

  bool get isUnread => unreadCount > 0;
}
