class LiveArtifact {
  const LiveArtifact({
    required this.id,
    required this.title,
    required this.updatedAt,
    this.updatedByDisplayName,
    this.ownerUserId,
    this.workspaceId,
    this.visibility = LiveArtifactVisibility.private,
    this.state,
    this.currentStateRevision = 0,
    this.currentBundleRevision = 0,
    this.declaredCapabilities = const [],
  });

  final String id;
  final String title;
  final DateTime updatedAt;
  final String? updatedByDisplayName;
  final int? ownerUserId;
  final int? workspaceId;
  final LiveArtifactVisibility visibility;
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
        ownerUserId: json['ownerUserId'] as int?,
        workspaceId: json['workspaceId'] as int?,
        visibility: LiveArtifactVisibility.parse(json['visibility']),
        state: json['state'],
        currentStateRevision: json['currentStateRevision'] as int? ?? 0,
        currentBundleRevision: json['currentBundleRevision'] as int? ?? 0,
        declaredCapabilities:
            (json['declaredCapabilities'] as List<dynamic>? ?? const [])
                .whereType<String>()
                .toList(growable: false),
      );
}

enum LiveArtifactVisibility {
  private,
  shared,
  organization;

  static LiveArtifactVisibility parse(Object? value) => switch (value) {
        'shared' => shared,
        'organization' => organization,
        _ => private,
      };

  String get wireName => name;

  String get label => switch (this) {
        private => 'Private',
        shared => 'Shared',
        organization => 'Organization',
      };
}

class LiveArtifactUser {
  const LiveArtifactUser({
    required this.id,
    required this.name,
    required this.email,
  });

  final int id;
  final String name;
  final String email;

  String get displayName => name.isNotEmpty ? name : email;

  factory LiveArtifactUser.fromJson(Map<String, dynamic> json) =>
      LiveArtifactUser(
        id: json['id'] as int,
        name: json['name'] as String? ?? '',
        email: json['email'] as String? ?? '',
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
