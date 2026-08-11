import '../data/tasks_local_data_source.dart';
import '../models/task.dart';

class TasksRepository {
  TasksRepository(this._dataSource);

  final TasksLocalDataSource _dataSource;

  Future<List<Task>> getAll() => _dataSource.fetchAll();

  Future<Task> create(
    String title, {
    String? notes,
    String? dueDate,
    String? scheduledDate,
    int? ownerId,
    int? collaboratorId,
    String? preferredAgent,
    String? goalId,
    int? priority,
    List<String> tags = const [],
    String? energy,
  }) async {
    final task = await _dataSource.create(
      title,
      notes: notes,
      dueDate: dueDate,
      scheduledDate: scheduledDate,
      ownerId: ownerId,
      preferredAgent: preferredAgent,
      goalId: goalId,
      priority: priority,
      tags: tags,
      energy: energy,
    );
    if (collaboratorId != null) {
      await _dataSource.addCollaborator(task.id, collaboratorId);
    }
    return task;
  }

  Future<Task> update(
    String id, {
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    String? status,
    int? ownerId,
    bool includeNotes = false,
    bool includeDueDate = false,
    bool includeScheduledDate = false,
    bool includeOwnerId = false,
    bool includePreferredAgent = false,
    String? preferredAgent,
    bool includeGoalId = false,
    String? goalId,
    bool includePriority = false,
    int? priority,
    bool includeTags = false,
    List<String>? tags,
    bool includeEnergy = false,
    String? energy,
  }) =>
      _dataSource.update(
        id,
        title: title,
        notes: notes,
        dueDate: dueDate,
        scheduledDate: scheduledDate,
        status: status,
        ownerId: ownerId,
        includeNotes: includeNotes,
        includeDueDate: includeDueDate,
        includeScheduledDate: includeScheduledDate,
        includeOwnerId: includeOwnerId,
        includePreferredAgent: includePreferredAgent,
        preferredAgent: preferredAgent,
        includeGoalId: includeGoalId,
        goalId: goalId,
        includePriority: includePriority,
        priority: priority,
        includeTags: includeTags,
        tags: tags,
        includeEnergy: includeEnergy,
        energy: energy,
      );

  Future<void> delete(String id) => _dataSource.delete(id);
}
