class WorkspaceInfo {
  const WorkspaceInfo({required this.id, required this.name, this.joinCode});

  final int id;
  final String name;
  final String? joinCode;

  factory WorkspaceInfo.fromJson(Map<String, dynamic> json) {
    return WorkspaceInfo(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String,
      joinCode: json['joinCode'] as String?,
    );
  }
}
