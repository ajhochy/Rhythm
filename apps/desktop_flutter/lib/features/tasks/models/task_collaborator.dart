import '../../../app/core/utils/json_parsing.dart';

class TaskCollaborator {
  const TaskCollaborator({
    required this.userId,
    required this.name,
    this.photoUrl,
  });

  final int userId;
  final String name;
  final String? photoUrl;

  factory TaskCollaborator.fromJson(Map<String, dynamic> json) {
    return TaskCollaborator(
      userId: asInt(json['userId']) ?? 0,
      name: asString(json['name']) ?? '',
      photoUrl: asString(json['photoUrl']),
    );
  }
}
