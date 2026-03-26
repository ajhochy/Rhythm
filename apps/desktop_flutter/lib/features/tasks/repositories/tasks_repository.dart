import '../data/tasks_local_data_source.dart';
import '../models/task.dart';

class TasksRepository {
  TasksRepository(this._dataSource);

  final TasksLocalDataSource _dataSource;

  Future<List<Task>> getAll() => _dataSource.fetchAll();

  Future<Task> create(String title, {String? notes, String? dueDate}) =>
      _dataSource.create(title, notes: notes, dueDate: dueDate);

  Future<Task> update(String id,
          {String? title, String? notes, String? dueDate, String? status}) =>
      _dataSource.update(id,
          title: title, notes: notes, dueDate: dueDate, status: status);

  Future<void> delete(String id) => _dataSource.delete(id);
}
