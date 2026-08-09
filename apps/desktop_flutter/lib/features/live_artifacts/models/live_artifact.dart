class LiveArtifact {
  const LiveArtifact({
    required this.id,
    required this.title,
    required this.updatedAt,
    required this.updatedByUserId,
  });

  final String id;
  final String title;
  final DateTime updatedAt;
  final int updatedByUserId;

  factory LiveArtifact.fromJson(Map<String, dynamic> json) => LiveArtifact(
        id: json['id'] as String,
        title: json['title'] as String,
        updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        updatedByUserId: json['updatedByUserId'] as int? ?? 0,
      );
}

enum LiveArtifactTabStatus {
  loading,
  ready,
  unavailable,
  deleted,
  conflict,
  error
}

class LiveArtifactTab {
  const LiveArtifactTab(
      {required this.id, required this.status, this.artifact, this.message});

  final String id;
  final LiveArtifactTabStatus status;
  final LiveArtifact? artifact;
  final String? message;
}
