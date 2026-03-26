class Task {
  Task({
    required this.id,
    required this.title,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.dueDate,
    this.sourceType,
    this.sourceId,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    return Task(
      id: json['id'] as String,
      title: json['title'] as String,
      dueDate: json['dueDate'] as String?,
      status: json['status'] as String? ?? 'open',
      sourceType: json['sourceType'] as String?,
      sourceId: json['sourceId'] as String?,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }

  final String id;
  final String title;
  final String? dueDate;
  final String status;
  final String? sourceType;
  final String? sourceId;
  final String createdAt;
  final String updatedAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'dueDate': dueDate,
        'status': status,
        'sourceType': sourceType,
        'sourceId': sourceId,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  Task copyWith({String? title, String? dueDate, String? status}) {
    return Task(
      id: id,
      title: title ?? this.title,
      dueDate: dueDate ?? this.dueDate,
      status: status ?? this.status,
      sourceType: sourceType,
      sourceId: sourceId,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}
