class Task {
  Task({
    required this.id,
    required this.title,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.notes,
    this.dueDate,
    this.scheduledDate,
    this.scheduledOrder,
    this.locked = false,
    this.sourceType,
    this.sourceId,
    this.sourceName,
    this.startsAt,
    this.endsAt,
    this.isAllDay = false,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    return Task(
      id: json['id'] as String,
      title: json['title'] as String,
      notes: json['notes'] as String?,
      dueDate: json['dueDate'] as String?,
      scheduledDate: json['scheduledDate'] as String?,
      scheduledOrder: json['scheduledOrder'] as int?,
      locked: (json['locked'] as bool?) ?? false,
      status: json['status'] as String? ?? 'open',
      sourceType: json['sourceType'] as String?,
      sourceId: json['sourceId'] as String?,
      sourceName: json['sourceName'] as String?,
      startsAt: json['startsAt'] as String?,
      endsAt: json['endsAt'] as String?,
      isAllDay: (json['isAllDay'] as bool?) ?? false,
      createdAt: json['createdAt'] as String? ?? '',
      updatedAt: json['updatedAt'] as String? ?? '',
    );
  }

  final String id;
  final String title;
  final String? notes;
  final String? dueDate;
  final String? scheduledDate;
  final int? scheduledOrder;
  final bool locked;
  final String status;
  final String? sourceType;
  final String? sourceId;
  final String? sourceName;
  final String? startsAt;
  final String? endsAt;
  final bool isAllDay;
  final String createdAt;
  final String updatedAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'notes': notes,
        'dueDate': dueDate,
        'scheduledDate': scheduledDate,
        'scheduledOrder': scheduledOrder,
        'locked': locked,
        'status': status,
        'sourceType': sourceType,
        'sourceId': sourceId,
        'sourceName': sourceName,
        'startsAt': startsAt,
        'endsAt': endsAt,
        'isAllDay': isAllDay,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  Task copyWith({
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    int? scheduledOrder,
    bool? locked,
    String? status,
  }) {
    return Task(
      id: id,
      title: title ?? this.title,
      notes: notes ?? this.notes,
      dueDate: dueDate ?? this.dueDate,
      scheduledDate: scheduledDate ?? this.scheduledDate,
      scheduledOrder: scheduledOrder ?? this.scheduledOrder,
      locked: locked ?? this.locked,
      status: status ?? this.status,
      sourceType: sourceType,
      sourceId: sourceId,
      sourceName: sourceName,
      startsAt: startsAt,
      endsAt: endsAt,
      isAllDay: isAllDay,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}
