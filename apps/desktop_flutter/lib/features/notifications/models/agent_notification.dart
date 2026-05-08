class AgentNotification {
  AgentNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.receivedAt,
    this.isRead = false,
  });

  final int id;
  final String title;
  final String body;
  final DateTime receivedAt;
  bool isRead;
}
