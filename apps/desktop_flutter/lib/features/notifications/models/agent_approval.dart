class AgentApproval {
  AgentApproval({
    required this.id,
    this.sessionId,
    required this.action,
    required this.preview,
    required this.consequence,
    required this.status,
    required this.createdAt,
    required this.decisionNonce,
    required this.payloadDigest,
  });

  factory AgentApproval.fromJson(Map<String, dynamic> json) => AgentApproval(
        id: json['id'] as String,
        sessionId: json['sessionId'] as String?,
        action: json['action'] as String,
        preview: json['preview'] as String?,
        consequence: json['consequence'] as String?,
        status: json['status'] as String,
        decisionNonce: json['decisionNonce'] as String,
        payloadDigest: json['payloadDigest'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.now(),
      );

  final String id;

  /// Local Rhythm session that originated this request.
  ///
  /// Null approvals remain available from the global notification surface,
  /// but are never composed into an arbitrary open transcript.
  final String? sessionId;
  final String action;
  final String? preview;
  final String? consequence;

  /// 'pending' | 'approved' | 'rejected'
  final String status;
  final DateTime createdAt;
  final String decisionNonce;
  final String? payloadDigest;
}
