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
    int? ownerId,
  }) =>
      _dataSource.create(
        title,
        notes: notes,
        dueDate: dueDate,
        ownerId: ownerId,
      );

  Future<Task> update(
    String id, {
    String? title,
    String? notes,
    String? dueDate,
    String? status,
    int? ownerId,
    bool includeNotes = false,
    bool includeDueDate = false,
    bool includeOwnerId = false,
  }) =>
      _dataSource.update(
        id,
        title: title,
        notes: notes,
        dueDate: dueDate,
        status: status,
        ownerId: ownerId,
        includeNotes: includeNotes,
        includeDueDate: includeDueDate,
        includeOwnerId: includeOwnerId,
      );

  Future<void> delete(String id) => _dataSource.delete(id);
}
