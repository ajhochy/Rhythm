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
      id: json['id'] as String,
      templateId: json['templateId'] as String,
      title: json['title'] as String,
      offsetDays: json['offsetDays'] as int,
      offsetDescription: json['offsetDescription'] as String?,
      sortOrder: json['sortOrder'] as int? ?? 0,
    );
  }

  final String id;
  final String templateId;
  final String title;
  final int offsetDays;
  final String? offsetDescription;
  final int sortOrder;
}
