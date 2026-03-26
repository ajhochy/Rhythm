import 'project_template_step.dart';

class ProjectTemplate {
  ProjectTemplate({
    required this.id,
    required this.name,
    required this.anchorType,
    required this.createdAt,
    required this.steps,
    this.description,
  });

  factory ProjectTemplate.fromJson(Map<String, dynamic> json) {
    final stepList = (json['steps'] as List<dynamic>? ?? [])
        .map((s) => ProjectTemplateStep.fromJson(s as Map<String, dynamic>))
        .toList();
    return ProjectTemplate(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      anchorType: json['anchorType'] as String? ?? 'date',
      createdAt: json['createdAt'] as String,
      steps: stepList,
    );
  }

  final String id;
  final String name;
  final String? description;
  final String anchorType;
  final String createdAt;
  final List<ProjectTemplateStep> steps;
}
