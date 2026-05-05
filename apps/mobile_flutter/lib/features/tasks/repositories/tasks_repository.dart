import '../data/tasks_data_source.dart';
import '../models/task.dart';

class TasksRepository {
  TasksRepository(this._dataSource);

  final TasksDataSource _dataSource;

  Future<List<Task>> fetchAll() => _dataSource.fetchAll();

  Future<Task> markDone(String id) => _dataSource.updateStatus(id, 'done');

  Future<Task> markOpen(String id) => _dataSource.updateStatus(id, 'open');
}
