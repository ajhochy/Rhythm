import '../../../app/core/utils/json_parsing.dart';

/// Branch listing returned by `GET /projects/:id/branches`.
class ProjectBranches {
  const ProjectBranches({
    required this.current,
    required this.local,
    required this.recent,
  });

  final String? current;

  /// All local branches (alphabetical).
  final List<String> local;

  /// Up to 5 branches ordered by most-recent commit date.
  final List<String> recent;

  factory ProjectBranches.fromJson(Map<String, dynamic> json) {
    return ProjectBranches(
      current: asString(json['current']),
      local: (json['local'] as List<dynamic>? ?? [])
          .map((e) => asString(e) ?? '')
          .where((s) => s.isNotEmpty)
          .toList(),
      recent: (json['recent'] as List<dynamic>? ?? [])
          .map((e) => asString(e) ?? '')
          .where((s) => s.isNotEmpty)
          .toList(),
    );
  }
}
