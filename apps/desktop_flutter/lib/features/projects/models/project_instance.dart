import '../../../app/core/utils/json_parsing.dart';
import '../../tasks/models/task_collaborator.dart';

class ProjectInstanceStep {
  ProjectInstanceStep({
    required this.id,
    required this.instanceId,
    required this.stepId,
    required this.title,
    required this.dueDate,
    required this.status,
    this.notes,
    this.assigneeId,
    this.assigneeName,
  });

  factory ProjectInstanceStep.fromJson(Map<String, dynamic> json) {
    return ProjectInstanceStep(
      id: asString(json['id']) ?? '',
      instanceId: asString(json['instanceId']) ?? '',
      stepId: asString(json['stepId']) ?? '',
      title: asString(json['title']) ?? '',
      dueDate: asString(json['dueDate']) ?? '',
      status: asString(json['status']) ?? 'open',
      notes: asString(json['notes']),
      assigneeId: asInt(json['assigneeId']),
      assigneeName: asString(json['assigneeName']),
    );
  }

  final String id;
  final String instanceId;
  final String stepId;
  final String title;
  final String dueDate;
  final String status;
  final String? notes;
  final int? assigneeId;
  final String? assigneeName;
}

class ProjectInstance {
  ProjectInstance({
    required this.id,
    required this.templateId,
    required this.name,
    required this.anchorDate,
    required this.status,
    required this.createdAt,
    required this.steps,
    this.ownerId,
    this.collaborators = const [],
  });

  factory ProjectInstance.fromJson(Map<String, dynamic> json) {
    final stepList = (json['steps'] as List<dynamic>? ?? [])
        .map((s) => ProjectInstanceStep.fromJson(s as Map<String, dynamic>))
        .toList();
    return ProjectInstance(
      id: json['id'] as String,
      templateId: json['templateId'] as String,
      name: json['name'] as String?,
      anchorDate: json['anchorDate'] as String,
      status: json['status'] as String? ?? 'active',
      createdAt: json['createdAt'] as String,
      steps: stepList,
      ownerId: json['ownerId'] as int?,
      collaborators: ((json['collaborators'] as List<dynamic>?) ?? const [])
          .map(
            (item) => TaskCollaborator.fromJson(item as Map<String, dynamic>),
          )
          .toList(),
    );
  }

  final String id;
  final String templateId;
  final String? name;
  final String anchorDate;
  final String status;
  final String createdAt;
  final List<ProjectInstanceStep> steps;
  final int? ownerId;
  final List<TaskCollaborator> collaborators;
}
