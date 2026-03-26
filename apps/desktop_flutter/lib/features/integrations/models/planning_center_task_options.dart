class PlanningCenterTeamOption {
  PlanningCenterTeamOption({
    required this.id,
    required this.name,
    required this.serviceTypeId,
    required this.serviceTypeName,
  });

  factory PlanningCenterTeamOption.fromJson(Map<String, dynamic> json) {
    return PlanningCenterTeamOption(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'Team',
      serviceTypeId: json['serviceTypeId'] as String? ?? '',
      serviceTypeName: json['serviceTypeName'] as String? ?? 'Service Type',
    );
  }

  final String id;
  final String name;
  final String serviceTypeId;
  final String serviceTypeName;
}

class PlanningCenterTaskOptions {
  PlanningCenterTaskOptions({
    required this.teams,
    required this.positionsByTeamId,
  });

  factory PlanningCenterTaskOptions.fromJson(Map<String, dynamic> json) {
    final rawMap = json['positionsByTeamId'];
    final positionsByTeamId = <String, List<String>>{};
    if (rawMap is Map<String, dynamic>) {
      rawMap.forEach((key, value) {
        positionsByTeamId[key] = _stringList(value);
      });
    }

    return PlanningCenterTaskOptions(
      teams: (json['teams'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PlanningCenterTeamOption.fromJson)
          .toList(),
      positionsByTeamId: positionsByTeamId,
    );
  }

  static List<String> _stringList(Object? value) {
    if (value is! List) return const [];
    return value.whereType<String>().toList();
  }

  final List<PlanningCenterTeamOption> teams;
  final Map<String, List<String>> positionsByTeamId;
}
