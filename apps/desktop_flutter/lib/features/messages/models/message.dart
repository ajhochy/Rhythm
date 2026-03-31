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
      id: json['id'] as int,
      threadId: json['threadId'] as int,
      senderName: json['senderName'] as String,
      content: json['body'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}
