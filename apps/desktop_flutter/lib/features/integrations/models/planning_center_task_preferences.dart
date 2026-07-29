class PlanningCenterTaskPreferences {
  PlanningCenterTaskPreferences({
    required this.teamIds,
    required this.positionNames,
  });

  factory PlanningCenterTaskPreferences.fromJson(Map<String, dynamic> json) {
    return PlanningCenterTaskPreferences(
      teamIds: _stringList(json['teamIds']),
      positionNames: _stringList(json['positionNames']),
    );
  }

  static List<String> _stringList(Object? value) {
    if (value is! List) return const [];
    return value.whereType<String>().toList();
  }

  final List<String> teamIds;
  final List<String> positionNames;

  Map<String, dynamic> toJson() => {
    'teamIds': teamIds,
    'positionNames': positionNames,
  };
}
