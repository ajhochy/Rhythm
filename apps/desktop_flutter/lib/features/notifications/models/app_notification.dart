class AppNotification {
  AppNotification({
    required this.id,
    required this.recipientUserId,
    required this.type,
    required this.entityType,
    required this.entityId,
    required this.message,
    required this.createdAt,
    this.readAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: (json['id'] as num).toInt(),
      recipientUserId: (json['recipientUserId'] as num).toInt(),
      type: json['type'] as String,
      entityType: json['entityType'] as String,
      entityId: json['entityId'] as String,
      message: json['message'] as String,
      createdAt: json['createdAt'] as String,
      readAt: json['readAt'] as String?,
    );
  }

  final int id;
  final int recipientUserId;
  final String type;
  final String entityType;
  final String entityId;
  final String message;
  final String createdAt;
  final String? readAt;
}
