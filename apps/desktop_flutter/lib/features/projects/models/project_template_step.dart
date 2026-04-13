import '../../../app/core/utils/json_parsing.dart';

class ProjectTemplateStep {
  ProjectTemplateStep({
    required this.id,
    required this.templateId,
    required this.title,
    required this.offsetDays,
    required this.sortOrder,
    this.offsetDescription,
  });

  factory ProjectTemplateStep.fromJson(Map<String, dynamic> json) {
    return ProjectTemplateStep(
      id: asString(json['id']) ?? '',
      templateId: asString(json['templateId']) ?? '',
      title: asString(json['title']) ?? '',
      offsetDays: asInt(json['offsetDays']) ?? 0,
      offsetDescription: asString(json['offsetDescription']),
      sortOrder: asInt(json['sortOrder']) ?? 0,
    );
  }

  final String id;
  final String templateId;
  final String title;
  final int offsetDays;
  final String? offsetDescription;
  final int sortOrder;
}
