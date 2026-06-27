class CookbookRecipe {
  CookbookRecipe({
    required this.id,
    required this.title,
    required this.description,
    required this.stepsJson,
    this.boundConfigId,
    required this.createdAt,
    required this.updatedAt,
  });

  factory CookbookRecipe.fromJson(Map<String, dynamic> json) {
    return CookbookRecipe(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      stepsJson: json['stepsJson'] as String? ?? '[]',
      boundConfigId: json['boundConfigId'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
      updatedAt: json['updatedAt'] as String? ?? '',
    );
  }

  final String id;
  final String title;
  final String description;
  final String stepsJson;
  final String? boundConfigId;
  final String createdAt;
  final String updatedAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'stepsJson': stepsJson,
        if (boundConfigId != null) 'boundConfigId': boundConfigId,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}
