import '../data/tasks_local_data_source.dart';
import '../models/task.dart';

class TasksRepository {
  TasksRepository(this._dataSource);

  final TasksLocalDataSource _dataSource;

  Future<List<Task>> getAll() => _dataSource.fetchAll();

  Future<Task> create(
    String title, {
    String? notes,
    String? scheduledDate,
    int? ownerId,
    int? collaboratorId,
    String? preferredAgent,
  }) async {
    final task = await _dataSource.create(
      title,
      notes: notes,
      scheduledDate: scheduledDate,
      ownerId: ownerId,
      preferredAgent: preferredAgent,
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
      );

  Future<void> delete(String id) => _dataSource.delete(id);
}
