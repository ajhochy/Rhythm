import '../../../app/core/utils/json_parsing.dart';

/// Client-side model mirroring api_server's `Project` entity.
///
/// VCS fields are read-only — the server is the single source of truth.
/// The controller never mutates them locally except via `fromJson`.
class AgentProject {
  const AgentProject({
    required this.id,
    required this.name,
    required this.cwd,
    this.icon,
    this.vcsRoot,
    this.vcsBranch,
    this.vcsDirty = false,
    this.vcsCheckedAt,
    required this.createdAt,
    this.archivedAt,
  });

  final String id;
  final String name;
  final String cwd;
  final String? icon;
  final String? vcsRoot;
  final String? vcsBranch;
  final bool vcsDirty;
  final DateTime? vcsCheckedAt;
  final DateTime createdAt;
  final DateTime? archivedAt;

  factory AgentProject.fromJson(Map<String, dynamic> json) {
    return AgentProject(
      id: asString(json['id']) ?? '',
      name: asString(json['name']) ?? '',
      cwd: asString(json['cwd']) ?? '',
      icon: asString(json['icon']),
      vcsRoot: asString(json['vcsRoot']),
      vcsBranch: asString(json['vcsBranch']),
      vcsDirty: asBool(json['vcsDirty']) ?? false,
      vcsCheckedAt: _parse(asString(json['vcsCheckedAt'])),
      createdAt: _parse(asString(json['createdAt'])) ?? DateTime.utc(1970),
      archivedAt: _parse(asString(json['archivedAt'])),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'cwd': cwd,
        if (icon != null) 'icon': icon,
        if (vcsRoot != null) 'vcsRoot': vcsRoot,
        if (vcsBranch != null) 'vcsBranch': vcsBranch,
        'vcsDirty': vcsDirty,
        if (vcsCheckedAt != null)
          'vcsCheckedAt': vcsCheckedAt!.toUtc().toIso8601String(),
        'createdAt': createdAt.toUtc().toIso8601String(),
        if (archivedAt != null)
          'archivedAt': archivedAt!.toUtc().toIso8601String(),
      };

  AgentProject copyWith({
    String? name,
    String? cwd,
    String? icon,
    DateTime? archivedAt,
  }) =>
      AgentProject(
        id: id,
        name: name ?? this.name,
        cwd: cwd ?? this.cwd,
        icon: icon ?? this.icon,
        vcsRoot: vcsRoot,
        vcsBranch: vcsBranch,
        vcsDirty: vcsDirty,
        vcsCheckedAt: vcsCheckedAt,
        createdAt: createdAt,
        archivedAt: archivedAt ?? this.archivedAt,
      );

  static DateTime? _parse(String? raw) {
    if (raw == null) return null;
    return DateTime.tryParse(raw);
  }
}
