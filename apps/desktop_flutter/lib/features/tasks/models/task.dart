import '../../../app/core/utils/json_parsing.dart';
import 'task_collaborator.dart';

enum TaskStatus { open, inProgress, waitingForReply, done, deferred }

extension TaskStatusJson on TaskStatus {
  bool get isActive => this != TaskStatus.done && this != TaskStatus.deferred;

  String toJson() {
    switch (this) {
      case TaskStatus.open:
        return 'open';
      case TaskStatus.inProgress:
        return 'in_progress';
      case TaskStatus.waitingForReply:
        return 'waiting_for_reply';
      case TaskStatus.done:
        return 'done';
      case TaskStatus.deferred:
        return 'deferred';
    }
  }

  static TaskStatus fromJson(String value) {
    switch (value) {
      case 'in_progress':
        return TaskStatus.inProgress;
      case 'waiting_for_reply':
        return TaskStatus.waitingForReply;
      case 'done':
        return TaskStatus.done;
      case 'deferred':
        return TaskStatus.deferred;
      default:
        return TaskStatus.open;
    }
  }
}

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
    this.ownerId,
    this.isShared = false,
    this.collaborators = const [],
    this.preferredAgent,
    this.goalId,
    this.priority,
    this.tags = const [],
    this.energy,
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
      status: TaskStatusJson.fromJson(asString(json['status']) ?? 'open'),
      sourceType: asString(json['sourceType']),
      sourceId: asString(json['sourceId']),
      sourceName: asString(json['sourceName']),
      startsAt: asString(json['startsAt']),
      endsAt: asString(json['endsAt']),
      isAllDay: asBool(json['isAllDay']) ?? false,
      ownerId: asInt(json['ownerId']),
      isShared: asBool(json['isShared']) ?? false,
      collaborators: ((json['collaborators'] as List<dynamic>?) ?? const [])
          .map(
            (item) => TaskCollaborator.fromJson(item as Map<String, dynamic>),
          )
          .toList(),
      createdAt: asString(json['createdAt']) ?? '',
      updatedAt: asString(json['updatedAt']) ?? '',
      preferredAgent: asString(json['preferredAgent']),
      goalId: asString(json['goalId']),
      priority: asInt(json['priority']),
      tags: ((json['tags'] as List<dynamic>?) ?? const [])
          .whereType<String>()
          .toList(growable: false),
      energy: asString(json['energy']),
    );
  }

  final String id;
  final String title;
  final String? notes;
  final String? dueDate;
  final String? scheduledDate;
  final int? scheduledOrder;
  final bool locked;
  final TaskStatus status;
  final String? sourceType;
  final String? sourceId;
  final String? sourceName;
  final String? startsAt;
  final String? endsAt;
  final bool isAllDay;
  final int? ownerId;
  final bool isShared;
  final List<TaskCollaborator> collaborators;
  final String createdAt;
  final String updatedAt;

  /// Preferred agent for this task. One of 'claude-code', 'codex', or null.
  final String? preferredAgent;
  final String? goalId;
  final int? priority;
  final List<String> tags;
  final String? energy;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'notes': notes,
        'dueDate': dueDate,
        'scheduledDate': scheduledDate,
        'scheduledOrder': scheduledOrder,
        'locked': locked,
        'status': status.toJson(),
        'sourceType': sourceType,
        'sourceId': sourceId,
        'sourceName': sourceName,
        'startsAt': startsAt,
        'endsAt': endsAt,
        'isAllDay': isAllDay,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
        'preferredAgent': preferredAgent,
        'goalId': goalId,
        'priority': priority,
        'tags': tags,
        'energy': energy,
      };

  Task copyWith({
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    int? scheduledOrder,
    bool? locked,
    TaskStatus? status,
    int? ownerId,
    bool? isShared,
    List<TaskCollaborator>? collaborators,
    Object? preferredAgent = _sentinel,
    Object? goalId = _sentinel,
    Object? priority = _sentinel,
    List<String>? tags,
    Object? energy = _sentinel,
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
      ownerId: ownerId ?? this.ownerId,
      isShared: isShared ?? this.isShared,
      collaborators: collaborators ?? this.collaborators,
      createdAt: createdAt,
      updatedAt: updatedAt,
      preferredAgent: identical(preferredAgent, _sentinel)
          ? this.preferredAgent
          : preferredAgent as String?,
      goalId: identical(goalId, _sentinel) ? this.goalId : goalId as String?,
      priority:
          identical(priority, _sentinel) ? this.priority : priority as int?,
      tags: tags ?? this.tags,
      energy: identical(energy, _sentinel) ? this.energy : energy as String?,
    );
  }
}

const Object _sentinel = Object();
