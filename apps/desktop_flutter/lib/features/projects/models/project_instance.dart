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
  });

  factory ProjectInstanceStep.fromJson(Map<String, dynamic> json) {
    return ProjectInstanceStep(
      id: json['id'] as String,
      instanceId: json['instanceId'] as String,
      stepId: json['stepId'] as String,
      title: json['title'] as String,
      dueDate: json['dueDate'] as String,
      status: json['status'] as String? ?? 'open',
      notes: json['notes'] as String?,
    );
  }

  final String id;
  final String instanceId;
  final String stepId;
  final String title;
  final String dueDate;
  final String status;
  final String? notes;
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
          .map((item) =>
              TaskCollaborator.fromJson(item as Map<String, dynamic>))
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
