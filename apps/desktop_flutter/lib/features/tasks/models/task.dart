import '../../../app/core/utils/json_parsing.dart';

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
      id: asString(json['id']) ?? '',
      title: asString(json['title']) ?? '',
      notes: asString(json['notes']),
      dueDate: asString(json['dueDate']),
      scheduledDate: asString(json['scheduledDate']),
      scheduledOrder: asInt(json['scheduledOrder']),
      locked: asBool(json['locked']) ?? false,
      status: asString(json['status']) ?? 'open',
      sourceType: asString(json['sourceType']),
      sourceId: asString(json['sourceId']),
      sourceName: asString(json['sourceName']),
      startsAt: asString(json['startsAt']),
      endsAt: asString(json['endsAt']),
      isAllDay: asBool(json['isAllDay']) ?? false,
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
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
