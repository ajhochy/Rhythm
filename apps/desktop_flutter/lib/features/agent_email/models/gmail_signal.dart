class AgentEmailGmailSignal {
  AgentEmailGmailSignal({
    required this.id,
    required this.fromName,
    required this.fromEmail,
    required this.subject,
    this.snippet,
    this.receivedAt,
    required this.isUnread,
  });

  factory AgentEmailGmailSignal.fromJson(Map<String, dynamic> json) {
    return AgentEmailGmailSignal(
      id: json['id'] as String? ?? json['externalId'] as String? ?? '',
      fromName: json['fromName'] as String? ?? '',
      fromEmail: json['fromEmail'] as String? ?? '',
      subject: json['subject'] as String? ?? '(No subject)',
      snippet: json['snippet'] as String?,
      receivedAt: json['receivedAt'] as String?,
      isUnread: json['isUnread'] as bool? ?? false,
    );
  }

  final String id;
  final String fromName;
  final String fromEmail;
  final String? snippet;
  final String? receivedAt;
  final bool isUnread;
  final String subject;
}
