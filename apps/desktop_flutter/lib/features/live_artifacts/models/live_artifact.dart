class LiveArtifact {
  const LiveArtifact({
    required this.id,
    required this.title,
    required this.updatedAt,
    this.updatedByDisplayName,
    this.state,
    this.currentStateRevision = 0,
    this.currentBundleRevision = 0,
    this.declaredCapabilities = const [],
  });

  final String id;
  final String title;
  final DateTime updatedAt;
  final String? updatedByDisplayName;
  final Object? state;
  final int currentStateRevision;
  final int currentBundleRevision;
  final List<String> declaredCapabilities;

  factory LiveArtifact.fromJson(Map<String, dynamic> json) => LiveArtifact(
        id: json['id'] as String,
        title: json['title'] as String,
        updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        updatedByDisplayName: json['updatedByDisplayName'] as String?,
        state: json['state'],
        currentStateRevision: json['currentStateRevision'] as int? ?? 0,
        currentBundleRevision: json['currentBundleRevision'] as int? ?? 0,
        declaredCapabilities:
            (json['declaredCapabilities'] as List<dynamic>? ?? const [])
                .whereType<String>()
                .toList(growable: false),
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
