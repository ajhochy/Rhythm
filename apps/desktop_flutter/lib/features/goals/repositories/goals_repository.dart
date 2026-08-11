import '../data/goals_data_source.dart';
import '../models/goal.dart';

class GoalsRepository {
  GoalsRepository(this._dataSource);

  final GoalsDataSource _dataSource;

  Future<List<Goal>> getAll() => _dataSource.fetchAll();
  Future<Goal> create(Map<String, dynamic> values) =>
      _dataSource.create(values);
  Future<Goal> update(String id, Map<String, dynamic> values) =>
      _dataSource.update(id, values);
  Future<void> delete(String id) => _dataSource.delete(id);
}
