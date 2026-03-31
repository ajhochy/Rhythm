class MessageThread {
  const MessageThread({
    required this.id,
    required this.title,
    this.lastMessage,
    required this.updatedAt,
  });

  final int id;
  final String title;
  final String? lastMessage;
  final DateTime updatedAt;

  factory MessageThread.fromJson(Map<String, dynamic> json) {
    return MessageThread(
      id: json['id'] as int,
      title: json['title'] as String,
      lastMessage: json['lastMessage'] as String?,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  bool get hasRecentActivity {
    final now = DateTime.now();
    return now.difference(updatedAt).inHours < 24;
  }
}
