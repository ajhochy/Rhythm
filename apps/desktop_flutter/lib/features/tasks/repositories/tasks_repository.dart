import '../data/tasks_local_data_source.dart';
import '../models/task.dart';

class TasksRepository {
  TasksRepository(this._dataSource);

  final TasksLocalDataSource _dataSource;

  Future<List<Task>> getAll() => _dataSource.fetchAll();

  Future<Task> create(String title, {String? dueDate}) =>
      _dataSource.create(title, dueDate: dueDate);

  Future<Task> update(String id,
          {String? title, String? dueDate, String? status}) =>
      _dataSource.update(id, title: title, dueDate: dueDate, status: status);

  Future<void> delete(String id) => _dataSource.delete(id);
}
