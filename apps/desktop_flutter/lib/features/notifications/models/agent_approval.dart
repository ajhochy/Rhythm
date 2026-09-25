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
    this.lane,
    this.laneReason,
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
        lane: json['lane'] as String?,
        laneReason: json['laneReason'] as String?,
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
  final String? lane;
  final String? laneReason;

  bool get isHardline => lane == 'hardline';

  String? get laneReasonCopy => switch (laneReason) {
        'external_data_taint' => 'External data requires a human approval.',
        'consequential_action' =>
          'This consequential action requires a human approval.',
        'approval_gate' => 'This action is waiting for approval.',
        _ => null,
      };
}
