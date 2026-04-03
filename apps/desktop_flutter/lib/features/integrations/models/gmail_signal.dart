class GmailSignal {
  GmailSignal({
    required this.id,
    required this.fromLabel,
    required this.subject,
    required this.isUnread,
    this.snippet,
    this.receivedAt,
    this.threadId,
  });

  factory GmailSignal.fromJson(Map<String, dynamic> json) {
    final fromName = json['fromName'] as String?;
    final fromEmail = json['fromEmail'] as String?;
    return GmailSignal(
      id: json['id'] as String? ?? json['externalId'] as String? ?? '',
      fromLabel: fromName?.isNotEmpty == true
          ? fromName!
          : (fromEmail?.isNotEmpty == true ? fromEmail! : 'Unknown sender'),
      subject: (json['subject'] as String?)?.trim().isNotEmpty == true
          ? (json['subject'] as String).trim()
          : '(No subject)',
      snippet: json['snippet'] as String?,
      receivedAt: json['receivedAt'] as String?,
      isUnread: json['isUnread'] as bool? ?? false,
      threadId: json['threadId'] as String?,
    );
  }

  final String id;
  final String fromLabel;
  final String subject;
  final String? snippet;
  final String? receivedAt;
  final bool isUnread;
  final String? threadId;
}
