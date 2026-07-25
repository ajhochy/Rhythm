class AgentDesign {
  AgentDesign({
    required this.id,
    required this.title,
    this.canvaUrl,
    this.artifactType,
    this.thumbnailUrl,
    this.sessionId,
    required this.createdAt,
  });

  factory AgentDesign.fromJson(Map<String, dynamic> json) {
    return AgentDesign(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '(Untitled)',
      canvaUrl: json['canvaUrl'] as String?,
      artifactType: json['artifactType'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      sessionId: json['sessionId'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
    );
  }

  final String id;
  final String title;
  final String? canvaUrl;
  final String? artifactType;
  final String? thumbnailUrl;
  final String? sessionId;
  final String createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        if (canvaUrl != null) 'canvaUrl': canvaUrl,
        if (artifactType != null) 'artifactType': artifactType,
        if (thumbnailUrl != null) 'thumbnailUrl': thumbnailUrl,
        if (sessionId != null) 'sessionId': sessionId,
        'createdAt': createdAt,
      };
}
