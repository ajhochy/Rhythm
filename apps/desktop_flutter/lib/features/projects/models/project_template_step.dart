import '../../../app/core/utils/json_parsing.dart';

class ProjectTemplateStep {
  ProjectTemplateStep({
    required this.id,
    required this.templateId,
    required this.title,
    required this.offsetDays,
    required this.sortOrder,
    this.offsetDescription,
    this.assigneeId,
    this.assigneeName,
  });

  factory ProjectTemplateStep.fromJson(Map<String, dynamic> json) {
    return ProjectTemplateStep(
      id: asString(json['id']) ?? '',
      templateId: asString(json['templateId']) ?? '',
      title: asString(json['title']) ?? '',
      offsetDays: asInt(json['offsetDays']) ?? 0,
      offsetDescription: asString(json['offsetDescription']),
      sortOrder: asInt(json['sortOrder']) ?? 0,
      assigneeId: asInt(json['assigneeId']),
      assigneeName: asString(json['assigneeName']),
    );
  }

  final String id;
  final String templateId;
  final String title;
  final int offsetDays;
  final String? offsetDescription;
  final int sortOrder;
  final int? assigneeId;
  final String? assigneeName;
}
