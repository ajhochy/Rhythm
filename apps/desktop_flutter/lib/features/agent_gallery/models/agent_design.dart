class AgentDesign {
  AgentDesign({
    required this.id,
    required this.title,
    required this.provider,
    this.artifactUrl,
    this.projectUrl,
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
      provider:
          json['provider'] as String? ??
          (json['canvaUrl'] != null ? 'canva' : 'local'),
      artifactUrl: json['artifactUrl'] as String?,
      projectUrl: (json['projectUrl'] ?? json['canvaUrl']) as String?,
      canvaUrl: json['canvaUrl'] as String?,
      artifactType: json['artifactType'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      sessionId: json['sessionId'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
    );
  }

  final String id;
  final String title;
  final String provider;
  final String? artifactUrl;
  final String? projectUrl;
  final String? canvaUrl;
  final String? artifactType;
  final String? thumbnailUrl;
  final String? sessionId;
  final String createdAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'provider': provider,
    if (artifactUrl != null) 'artifactUrl': artifactUrl,
    if (projectUrl != null) 'projectUrl': projectUrl,
    if (canvaUrl != null) 'canvaUrl': canvaUrl,
    if (artifactType != null) 'artifactType': artifactType,
    if (thumbnailUrl != null) 'thumbnailUrl': thumbnailUrl,
    if (sessionId != null) 'sessionId': sessionId,
    'createdAt': createdAt,
  };
}
